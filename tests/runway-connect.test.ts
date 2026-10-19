import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRunway, pendingRunway, finishRunway, runwayStatus, checkRunway, disconnectRunway, runwayCallback } from '../src/lib/production/runway-connect';

test('Runway OAuth binds owner/browser, uses PKCE once, discovers JSON/SSE tools without generation and keeps tokens private', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scenepilot-runway-'));
  const scope = { ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() };
  const methods: string[] = []; let challenge = '', exchanges = 0, refreshes = 0;
  const host = 'https://mcp.runwayml.com';
  const transport: typeof fetch = async (url, init) => {
    assert.equal(new URL(String(url)).origin, host);
    assert.equal(init?.redirect, 'error');
    const path = new URL(String(url)).pathname;
    if (path.endsWith('oauth-authorization-server')) return Response.json({ issuer: host, authorization_endpoint: host + '/authorize', token_endpoint: host + '/token', registration_endpoint: host + '/register', code_challenge_methods_supported: ['S256'] });
    if (path === '/register') {
      const body = JSON.parse(String(init?.body)); assert.deepEqual(body.redirect_uris, [runwayCallback]); assert.equal(body.token_endpoint_auth_method, 'none');
      return Response.json({ client_id: 'fixture-client', token_endpoint_auth_method: 'none' });
    }
    if (path === '/token') {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') === 'refresh_token') { refreshes++; assert.equal(body.get('refresh_token'), 'secret-refresh'); }
      else {
        exchanges++; assert.equal(body.get('redirect_uri'), runwayCallback);
        assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), challenge);
      }
      return Response.json({ access_token: 'secret-access', refresh_token: 'secret-refresh', token_type: 'Bearer', expires_in: 3600 });
    }
    assert.equal(path, '/mcp');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer secret-access');
    const body = JSON.parse(String(init?.body)); methods.push(body.method);
    assert.ok(['initialize', 'notifications/initialized', 'tools/list'].includes(body.method));
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'initialize') return Response.json({ id: body.id, result: { protocolVersion: '2025-03-26' } }, { headers: { 'Mcp-Session-Id': 'fixture-session' } });
    assert.equal(new Headers(init?.headers).get('Mcp-Session-Id'), 'fixture-session');
    if (!body.params.cursor) return new Response(`event: message\r\ndata: ${JSON.stringify({ id: body.id, result: { tools: [{ name: 'fixture_video', inputSchema: { type: 'object' } }], nextCursor: 'page2' } })}\r\n\r\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    return Response.json({ id: body.id, result: { tools: [{ name: 'fixture_status' }] } });
  };
  try {
    const start = await startRunway(scope, root, transport);
    const url = new URL(start.url); challenge = url.searchParams.get('code_challenge')!;
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    await assert.rejects(pendingRunway(scope.ownerId, start.state, 'wrong', root));
    await assert.rejects(pendingRunway(randomUUID(), start.state, start.state, root));
    await finishRunway(scope.ownerId, start.state, start.state, 'fixture-code', root, transport);
    await assert.rejects(finishRunway(scope.ownerId, start.state, start.state, 'fixture-code', root, transport));
    assert.equal(exchanges, 1);
    assert.deepEqual(await runwayStatus(randomUUID(), root), { connected: false });
    const status = await checkRunway(scope.ownerId, root, transport);
    assert.deepEqual(status.toolNames, ['fixture_video', 'fixture_status']);
    assert.doesNotMatch(JSON.stringify(status), /secret-access|secret-refresh|fixture-client/);
    assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);
    const file = join(root, '.connections', scope.ownerId, 'runway', 'connection.json');
    const connection = JSON.parse(await readFile(file, 'utf8')); connection.expires = 0; await writeFile(file, JSON.stringify(connection));
    await checkRunway(scope.ownerId, root, transport); assert.equal(refreshes, 1);
    await assert.rejects(checkRunway(scope.ownerId, root, async () => new Response('secret-provider-error', { status: 401 })), e => e instanceof Error && /HTTP 401/.test(e.message) && !e.message.includes('secret-provider-error'));
    await disconnectRunway(scope.ownerId, root); assert.deepEqual(await runwayStatus(scope.ownerId, root), { connected: false });
    await assert.rejects(readFile(file));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Runway refuses redirected authorization metadata before registration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scenepilot-runway-'));
  let calls = 0;
  try {
    await assert.rejects(startRunway({ ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() }, root, async () => { calls++; return Response.json({ issuer: 'https://untrusted.example' }); }), /изменил способ/);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
