import { parseAlignment, type Alignment } from './model';

export class ProviderError extends Error {
  constructor(message: string, public uncertain = false, public imageTaskFinished = false) { super(message); }
}
export type ProviderConfig = { enabled: boolean; elevenKey: string; bflKey: string; cloudflareAccountId?: string; cloudflareToken?: string; geminiKey?: string };
export function providerConfig(): ProviderConfig {
  return { enabled: process.env.VIDEO_GENERATION_ENABLED === 'true', elevenKey: process.env.ELEVENLABS_API_KEY || '', bflKey: process.env.BFL_API_KEY || '', cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '', cloudflareToken: process.env.CLOUDFLARE_API_TOKEN || '', geminiKey: process.env.GEMINI_API_KEY || '' };
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
export async function speechRejectionHint(response: Response, permission: string) {
  const hints: Record<string, string> = {
    payment_required: 'Требуется оплата или другой доступный голос. На Free голоса из Voice Library недоступны через API даже при остатке кредитов. Проверьте тип голоса, тариф и лимит ключа; смена VPN это ограничение не снимает.',
    quota_exceeded: 'Недостаточно квоты для этого текста. Проверьте остаток аккаунта и ограничение расходов API-ключа. Повтор без изменения условий не поможет.',
    insufficient_credits: 'Недостаточно кредитов для этого запроса. Проверьте баланс аккаунта и лимит API-ключа.',
    voice_not_found: 'Голос не найден для этого аккаунта. Добавьте нужный голос в My Voices и скопируйте его Voice ID. Если ID изменился, создайте новую сборку: существующая хранит прежний голос.',
    invalid_voice_id: 'Неверный Voice ID. Скопируйте идентификатор через Copy voice ID в My Voices, затем создайте новую сборку.',
    voice_access_denied: 'Аккаунт не имеет доступа к этому голосу. Проверьте его доступность в My Voices или выберите другой голос.',
    subscription_required: 'Для этого действия требуется платная подписка. Проверьте условия выбранного голоса; для теста можно выбрать голос, доступный вашему тарифу.',
    paid_plan_required: 'Для этого действия требуется платный тариф. Проверьте условия выбранного голоса или выберите доступный голос.',
    feature_not_available: 'Эта возможность недоступна на текущем тарифе. Проверьте условия выбранного голоса.',
    missing_permission: `У ключа нет нужного разрешения. Проверьте ${permission}.`,
    insufficient_permissions: `У ключа нет нужного разрешения. Проверьте ${permission}.`,
    invalid_api_key: 'Ключ API отклонён. Проверьте ключ и срок его действия.',
    invalid_parameters: 'API отклонил параметры запроса. Проверьте выбранный Voice ID; повтор без изменения параметров может не помочь.',
  };
  // Only known codes are exposed. Raw provider messages may contain private data.
  try {
    const value: unknown = JSON.parse((await limitedBytes(response, 64000)).toString('utf8'));
    if (value && typeof value === 'object' && 'detail' in value) {
      const detail = value.detail;
      if (detail && typeof detail === 'object') {
        const code = 'code' in detail ? detail.code : 'status' in detail ? detail.status : undefined;
        if (typeof code === 'string' && Object.hasOwn(hints, code)) return `${code}: ${hints[code]}`;
      }
    }
  } catch { /* Keep the HTTP status even if the error body is unreadable or too large. */ }
  finally { await response.body?.cancel().catch(() => {}); }
  if (response.status === 400 || response.status === 422) return 'API отклонил запрос. Точная причина не распознана; проверьте Voice ID и доступность голоса в аккаунте.';
  if (response.status === 401) return `Проверьте ключ, срок действия и разрешение ${permission}.`;
  if (response.status === 403) return `Проверьте доступ из вашей страны и разрешение ${permission}.`;
  if (response.status === 404) return 'Голос не найден. Добавьте его в My Voices и скопируйте Voice ID.';
  if (response.status === 402) return 'Запрос отклонён по условиям оплаты или доступа. Проверьте квоту, лимит ключа и голос: на Free голоса Voice Library недоступны через API. Точная причина не распознана.';
  if (response.status === 429) return 'Лимит запросов. Повторите проверку позже вручную.';
  return 'Сервис не выполнил запрос. Повторите проверку позже вручную.';
}

async function request(url: string, options: RequestInit, transport: typeof fetch, name: string) {
  let response: Response;
  try { response = await transport(url, { ...options, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(120000) }); }
  catch { throw new ProviderError(`${name}: соединение прервано. Новый запрос автоматически не отправлен.`, true); }
  if (!response.ok) {
    const hint = name === 'ElevenLabs' ? await speechRejectionHint(response, 'Text to Speech: Access') : 'Проверьте доступ, баланс и настройки сервиса.';
    await response.body?.cancel().catch(() => {});
    throw new ProviderError(`${name}: HTTP ${response.status}. ${hint}`, response.status >= 500 || response.status === 408);
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
  if (['Pending', 'Running', 'Processing', 'Reasoning', 'Generating'].includes(String(payload.status))) return { pending: true };
  if (['Task not found', 'Request Moderated', 'Content Moderated', 'No Card Generated', 'Error'].includes(String(payload.status))) throw new ProviderError('BFL не завершил генерацию: задача отклонена, завершилась ошибкой или результат истёк. Проверьте историю BFL; новый запрос возможен отдельной кнопкой кадра.', false, true);
  if (payload.status !== 'Ready') throw new ProviderError('BFL вернул неизвестное состояние задачи. Проверьте задачу позже; новый запрос не выполнялся.', true);
  const result = payload.result as { sample?: unknown } | undefined;
  const bytes = await limitedBytes(await request(imageURL(result?.sample), {}, transport, 'Файл BFL'), 16 * 1024 * 1024);
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new ProviderError('BFL вернул файл, который не является JPEG.');
  return { pending: false, bytes };
}
