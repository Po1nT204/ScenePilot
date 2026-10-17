import { parseAlignment, type Alignment } from './model';

export class ProviderError extends Error {
  constructor(message: string, public uncertain = false) { super(message); }
}
export type ProviderConfig = { enabled: boolean; elevenKey: string; bflKey: string };
export function providerConfig(): ProviderConfig {
  return { enabled: process.env.VIDEO_GENERATION_ENABLED === 'true', elevenKey: process.env.ELEVENLABS_API_KEY || '', bflKey: process.env.BFL_API_KEY || '' };
}
export async function limitedBytes(response: Response, max: number) {
  if (Number(response.headers.get('content-length')) > max) throw new ProviderError('Ответ провайдера слишком велик.', true);
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError('Пустой ответ провайдера.', true);
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > max) throw new ProviderError('Ответ провайдера слишком велик.', true);
      parts.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts);
}
async function request(url: string, options: RequestInit, transport: typeof fetch, name: string) {
  let response: Response;
  try { response = await transport(url, { ...options, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(120000) }); }
  catch { throw new ProviderError(`${name}: соединение прервано. Новый запрос автоматически не отправлен.`, true); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError(`${name}: HTTP ${response.status}. Проверьте доступ, баланс и настройки сервиса.`, response.status >= 500 || response.status === 408);
  }
  return response;
}
async function json(response: Response, max = 256000): Promise<Record<string, unknown>> {
  try { return JSON.parse((await limitedBytes(response, max)).toString('utf8')); }
  catch (e) { if (e instanceof ProviderError) throw e; throw new ProviderError('Провайдер вернул нечитаемый ответ.', true); }
}
export function pollingURL(value: unknown) {
  if (typeof value !== 'string') throw new ProviderError('BFL не вернул адрес проверки задачи.', true);
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !/^api(?:\.[a-z0-9-]+)?\.bfl\.(ai|ml)$/.test(u.hostname) || u.pathname !== '/v1/get_result') throw new ProviderError('BFL вернул неожиданный адрес проверки.', true);
  return u.toString();
}
export function imageURL(value: unknown) {
  if (typeof value !== 'string') throw new ProviderError('BFL не вернул файл изображения.');
  const u = new URL(value);
  const allowed = /(^|\.)bfl\.(ai|ml)$/.test(u.hostname) || /^bfl[a-z0-9-]*\.blob\.core\.windows\.net$/.test(u.hostname);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !allowed) throw new ProviderError('BFL вернул неподдерживаемый адрес файла.');
  return u.toString();
}
export async function synthesize(text: string, voiceId: string, key: string, transport: typeof fetch = fetch): Promise<{ bytes: Buffer; alignment: Alignment; requestId?: string }> {
  if (!key || !/^[a-zA-Z0-9_-]{5,100}$/.test(voiceId)) throw new ProviderError('Не настроены ключ ElevenLabs или Voice ID.');
  const response = await request(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  }, transport, 'ElevenLabs');
  const payload = await json(response, 24 * 1024 * 1024);
  if (typeof payload.audio_base64 !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(payload.audio_base64)) throw new ProviderError('ElevenLabs не вернул аудиофайл.', true);
  const bytes = Buffer.from(payload.audio_base64, 'base64');
  if (bytes.length < 32 || bytes.length > 16 * 1024 * 1024 || !(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224))) throw new ProviderError('ElevenLabs вернул неподдерживаемое аудио.', true);
  let alignment: Alignment;
  try { alignment = parseAlignment(payload.alignment, text); }
  catch { throw new ProviderError('Аудио получено, но тайминги не соответствуют сценарию. Проверьте результат в ElevenLabs; повтор не выполнялся.', true); }
  return { bytes, alignment, requestId: response.headers.get('request-id') || undefined };
}
export async function submitImage(prompt: string, key: string, transport: typeof fetch = fetch) {
  if (!key) throw new ProviderError('Не настроен ключ BFL.');
  const payload = await json(await request('https://api.bfl.ai/v1/flux-pro-1.1', {
    method: 'POST', headers: { 'x-key': key, 'Content-Type': 'application/json' },
    // FLUX dimensions use a 32-pixel grid. The renderer crops 736 to 720.
    body: JSON.stringify({ prompt, width: 1280, height: 736, output_format: 'jpeg', prompt_upsampling: false }),
  }, transport, 'BFL'));
  if (typeof payload.id !== 'string' || payload.id.length > 200) throw new ProviderError('BFL не вернул номер задачи.', true);
  return { requestId: payload.id, pollingUrl: pollingURL(payload.polling_url) };
}
export async function checkImage(url: string, key: string, transport: typeof fetch = fetch): Promise<{ pending: true } | { pending: false; bytes: Buffer }> {
  const payload = await json(await request(pollingURL(url), { headers: { 'x-key': key } }, transport, 'BFL'));
  if (payload.status === 'Pending' || payload.status === 'Running' || payload.status === 'Processing') return { pending: true };
  if (payload.status !== 'Ready') throw new ProviderError('BFL не завершил генерацию: задача отклонена, завершилась ошибкой или результат истёк. Новый запрос не выполнялся.');
  const result = payload.result as { sample?: unknown } | undefined;
  const bytes = await limitedBytes(await request(imageURL(result?.sample), {}, transport, 'Файл BFL'), 16 * 1024 * 1024);
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new ProviderError('BFL вернул файл, который не является JPEG.');
  return { pending: false, bytes };
}
