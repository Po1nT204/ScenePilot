import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, productionRoot, validJobId, withLock } from './store';
import { limitedBytes } from './providers';
import type { VideoScope } from './model';

const host = 'https://mcp.runwayml.com';
const resource = `${host}/mcp`;
export const runwayCallback = 'http://127.0.0.1:3000/projects/runway/callback';
export const runwayCookie = 'scenepilot-runway-state';
type Pending = VideoScope & { state: string; verifier: string; client: string; expires: number };
type Connection = { access: string; refresh?: string; client: string; expires: number; checkedAt?: string; toolNames?: string[] };
export type RunwayStatus = { connected: boolean; checkedAt?: string; toolNames?: string[] };
function directory(owner: string, root: string) {
  if (!validJobId(owner)) throw new Error('Некорректный владелец подключения.');
  return join(root, '.connections', owner, 'runway');
}
async function read<T>(file: string): Promise<T | undefined> {
  try { if ((await stat(file)).size > 2 * 1024 * 1024) throw new Error('Файл подключения повреждён.'); return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
async function request(path: string, init: RequestInit, transport: typeof fetch) {
  let response: Response;
  try { response = await transport(host + path, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('Runway: не удалось соединиться. Проверьте доступ приложения к сети. Генерация не запускалась.'); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Runway: HTTP ${response.status}. Проверьте доступ аккаунта или подключитесь заново. Генерация не запускалась.`);
  }
  return response;
}
async function json(response: Response, max = 256000) {
  try { return JSON.parse((await limitedBytes(response, max)).toString('utf8')); }
  catch { throw new Error('Runway вернул неподдерживаемый ответ. Генерация не запускалась.'); }
}
export async function startRunway(scope: VideoScope, root = productionRoot(), transport: typeof fetch = fetch) {
  if (![scope.ownerId, scope.projectId, scope.versionId].every(validJobId)) throw new Error('Некорректная версия проекта.');
  const dir = directory(scope.ownerId, root); await mkdir(dir, { recursive: true });
  return withLock(join(dir, 'connection.lock'), async () => {
    const metadata = await json(await request('/.well-known/oauth-authorization-server', { method: 'GET' }, transport));
    if (metadata.issuer !== host || metadata.authorization_endpoint !== `${host}/authorize` || metadata.token_endpoint !== `${host}/token` ||
        metadata.registration_endpoint !== `${host}/register` || !metadata.code_challenge_methods_supported?.includes('S256')) throw new Error('Runway изменил способ подключения. Нужна проверка интеграции.');
    let registration = await read<{ client: string }>(join(dir, 'client.json'));
    if (!registration) {
      const result = await json(await request('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        client_name: 'ScenePilot Local', redirect_uris: [runwayCallback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
      }) }, transport));
      if (typeof result.client_id !== 'string' || !result.client_id || result.client_id.length > 2000 || (result.token_endpoint_auth_method && result.token_endpoint_auth_method !== 'none')) throw new Error('Runway не разрешил подключение локального приложения.');
      registration = { client: result.client_id }; await atomicWrite(join(dir, 'client.json'), JSON.stringify(registration));
    }
    const pending: Pending = { ...scope, state: randomBytes(32).toString('base64url'), verifier: randomBytes(32).toString('base64url'), client: registration.client, expires: Date.now() + 10 * 60 * 1000 };
    await atomicWrite(join(dir, 'pending.json'), JSON.stringify(pending));
    const url = new URL(`${host}/authorize`);
    url.search = new URLSearchParams({ response_type: 'code', client_id: pending.client, redirect_uri: runwayCallback, scope: 'openid api:read_write', resource,
      state: pending.state, code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return { url: url.toString(), state: pending.state };
  });
}
export async function pendingRunway(owner: string, state: string, cookie: string, root = productionRoot()) {
  if (!/^[\w-]{43}$/.test(state) || state !== cookie) throw new Error('Подключение устарело. Начните вход из ScenePilot ещё раз.');
  const pending = await read<Pending>(join(directory(owner, root), 'pending.json'));
  if (!pending || pending.ownerId !== owner || pending.state !== state || pending.expires < Date.now()) throw new Error('Подключение устарело. Начните вход из ScenePilot ещё раз.');
  return pending;
}
function tokens(data: Record<string, unknown>, client: string, oldRefresh?: string): Connection {
  if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16000 || /\s/.test(data.access_token) ||
      typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || data.refresh_token.length > 16000))) throw new Error('Runway не вернул подходящее разрешение доступа.');
  return { access: data.access_token, refresh: data.refresh_token as string | undefined ?? oldRefresh, client, expires: Date.now() + data.expires_in * 1000 };
}
export async function finishRunway(owner: string, state: string, cookie: string, code: string, root = productionRoot(), transport: typeof fetch = fetch) {
  const dir = directory(owner, root);
  return withLock(join(dir, 'connection.lock'), async () => {
    const pending = await pendingRunway(owner, state, cookie, root);
    if (!code || code.length > 4000) throw new Error('Runway не вернул код входа.');
    await unlink(join(dir, 'pending.json')); // One-time exchange, no automatic replay.
    const result = await json(await request('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: pending.client, redirect_uri: runwayCallback, code_verifier: pending.verifier, resource,
    }).toString() }, transport));
    await atomicWrite(join(dir, 'connection.json'), JSON.stringify(tokens(result, pending.client)));
    return pending;
  });
}
export async function runwayStatus(owner: string, root = productionRoot()): Promise<RunwayStatus> {
  const saved = await read<Connection>(join(directory(owner, root), 'connection.json'));
  return saved ? { connected: true, checkedAt: saved.checkedAt, toolNames: saved.toolNames } : { connected: false };
}
export async function disconnectRunway(owner: string, root = productionRoot()) {
  const dir = directory(owner, root);
  await withLock(join(dir, 'connection.lock'), async () => {
    for (const name of ['connection.json', 'pending.json', 'tools.json']) await unlink(join(dir, name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
  });
}

// Read-only MCP discovery. No tools/call entry point exists in this module.
async function rpcResult(response: Response, id: number) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await json(response, 1024 * 1024);
    if (data.id !== id || data.error || !data.result) throw new Error('Runway не подтвердил запрос каталога.');
    return data.result;
  }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Пустой ответ Runway.');
  const decoder = new TextDecoder(); let buffer = '', size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 1024 * 1024) throw new Error('Каталог Runway слишком велик.');
      buffer += decoder.decode(part.value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const payload = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!payload) continue;
        const data = JSON.parse(payload);
        if (data.id === id) { if (data.error || !data.result) throw new Error('Runway отклонил запрос каталога.'); return data.result; }
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  throw new Error('Runway не завершил проверку каталога.');
}
export async function checkRunway(owner: string, root = productionRoot(), transport: typeof fetch = fetch): Promise<RunwayStatus> {
  const dir = directory(owner, root);
  return withLock(join(dir, 'connection.lock'), async () => {
    let saved = await read<Connection>(join(dir, 'connection.json'));
    if (!saved) throw new Error('Сначала подключите аккаунт Runway.');
    if (saved.expires < Date.now() + 30000) {
      if (!saved.refresh) throw new Error('Вход Runway истёк. Подключитесь заново.');
      const result = await json(await request('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: saved.refresh, client_id: saved.client, resource,
      }).toString() }, transport));
      saved = tokens(result, saved.client, saved.refresh); await atomicWrite(join(dir, 'connection.json'), JSON.stringify(saved));
    }
    let session = '', version = '2025-03-26', sequence = 0;
    const rpc = async (method: 'initialize' | 'notifications/initialized' | 'tools/list', params?: object) => {
      const id = method.startsWith('notifications/') ? undefined : ++sequence;
      const headers: Record<string, string> = { Authorization: `Bearer ${saved!.access}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
      if (session) headers['Mcp-Session-Id'] = session;
      if (method !== 'initialize') headers['MCP-Protocol-Version'] = version;
      const response = await request('/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) }, transport);
      const next = response.headers.get('mcp-session-id'); if (next) session = next;
      if (id === undefined) { await response.body?.cancel().catch(() => {}); return; }
      return rpcResult(response, id);
    };
    try {
      const init = await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'ScenePilot', version: '0.1.0' } });
      if (!['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(init.protocolVersion)) throw new Error('Неподдерживаемая версия Runway MCP.');
      version = init.protocolVersion;
      await rpc('notifications/initialized');
      const tools: { name: string; inputSchema?: object; description?: string }[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 8; page++) {
        const result = await rpc('tools/list', cursor ? { cursor } : {});
        if (!Array.isArray(result.tools) || result.tools.some((tool: { name?: unknown }) => !tool || typeof tool.name !== 'string' || !/^[\w.:-]{1,160}$/.test(tool.name))) throw new Error('Неподдерживаемый каталог Runway.');
        tools.push(...result.tools); if (tools.length > 200) throw new Error('Каталог Runway слишком велик.');
        cursor = result.nextCursor;
        if (!cursor) break;
        if (typeof cursor !== 'string' || cursor.length > 4000 || page === 7) throw new Error('Каталог Runway не завершён.');
      }
      saved.checkedAt = new Date().toISOString(); saved.toolNames = tools.map(t => t.name);
      await atomicWrite(join(dir, 'tools.json'), JSON.stringify({ checkedAt: saved.checkedAt, tools }));
      await atomicWrite(join(dir, 'connection.json'), JSON.stringify(saved));
      return { connected: true, checkedAt: saved.checkedAt, toolNames: saved.toolNames };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Runway: HTTP')) throw e;
      throw new Error('Не удалось проверить инструменты Runway. Подключитесь заново или повторите проверку вручную. Генерация не запускалась.');
    }
  });
}
