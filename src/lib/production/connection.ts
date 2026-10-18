import { validVoice, type SpeechConnection } from './model';
import { limitedBytes, ProviderError } from './providers';

async function rejectionHint(response: Response, permission: string) {
  const hints: Record<string, string> = {
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
  if (response.status === 402) return 'Проверьте условия тарифа и баланс в ElevenLabs.';
  if (response.status === 429) return 'Лимит запросов. Повторите проверку позже вручную.';
  return 'Сервис не выполнил запрос. Повторите проверку позже вручную.';
}

function connectionFailure(error: unknown, stage: string): ProviderError {
  // Never surface raw messages: a transport error can contain keys or proxy URLs.
  const codes = new Set<string>();
  const inspect = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 3) return;
    const item = value as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown };
    if (typeof item.code === 'string') codes.add(item.code);
    if (item.name === 'TimeoutError' || item.name === 'AbortError') codes.add('TIMEOUT');
    inspect(item.cause, depth + 1);
    if (Array.isArray(item.errors)) item.errors.slice(0, 8).forEach(e => inspect(e, depth + 1));
  };
  inspect(error);
  let detail = 'Сетевой запрос не завершён.';
  if (['TIMEOUT', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].some(c => codes.has(c))) detail = 'Истекло время ожидания ответа API.';
  else if (['ENOTFOUND', 'EAI_AGAIN'].some(c => codes.has(c))) detail = 'Не удалось найти адрес api.elevenlabs.io (DNS).';
  else if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID'].some(c => codes.has(c))) detail = 'Ошибка проверки сертификата HTTPS. Проверьте дату компьютера и сертификаты сети; не отключайте проверку HTTPS.';
  else if (['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET'].some(c => codes.has(c))) detail = 'Соединение сброшено, отклонено или маршрут недоступен.';
  return new ProviderError(`ElevenLabs — ${stage}: ${detail} Проверьте соединение самого приложения: Node.js 20 не подхватывает системный прокси Windows автоматически. Открытый сайт в браузере не подтверждает доступ приложения. Генерация не запускалась.`);
}

// Metadata only. Never calls synthesis, downloads previews or sends the script.
export async function checkSpeechConnection(voiceId: string, key: string, transport: typeof fetch = fetch): Promise<SpeechConnection> {
  if (!key) throw new ProviderError('Добавьте ELEVENLABS_API_KEY в .env.local и перезапустите приложение.');
  if (!validVoice(voiceId)) throw new ProviderError('Укажите корректный Voice ID ElevenLabs.');
  let headers: Headers;
  try { headers = new Headers({ 'xi-api-key': key }); }
  catch { throw new ProviderError('Неверный формат ELEVENLABS_API_KEY: проверьте, что вставлен сам секретный ключ без переносов строк и пояснений. Значение ключа никому не отправляйте.'); }
  async function get(path: string, permission: string): Promise<Record<string, unknown>> {
    const stage = path === 'user/subscription' ? 'проверка подписки' : 'проверка голоса';
    try {
      const response = await transport(`https://api.elevenlabs.io/v1/${path}`, {
        method: 'GET', headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const hint = await rejectionHint(response, permission);
        throw new ProviderError(`ElevenLabs — ${stage}: HTTP ${response.status}. ${hint} Генерация не запускалась.`);
      }
      const body = (await limitedBytes(response, 256000)).toString('utf8');
      let value: unknown;
      try { value = JSON.parse(body); }
      catch { throw new ProviderError(`ElevenLabs — ${stage}: получен HTTP ${response.status}, но ответ не является JSON API. Проверьте, не подменяет ли его прокси или страница входа. Генерация не запускалась.`); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderError('ElevenLabs вернул некорректные сведения.');
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw connectionFailure(error, stage);
    }
  }
  const subscription = await get('user/subscription', 'User: Read');
  const { character_count: used, character_limit: limit, tier } = subscription;
  if (typeof used !== 'number' || !Number.isSafeInteger(used) || used < 0 || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0 || typeof tier !== 'string' || !/^[a-z0-9_-]{1,50}$/i.test(tier)) {
    throw new ProviderError('ElevenLabs не вернул корректные сведения о тарифе и квоте. Проверьте кабинет сервиса.');
  }
  const voice = await get(`voices/${voiceId}`, 'Voices: Read');
  if (voice.voice_id !== voiceId) throw new ProviderError('ElevenLabs не подтвердил выбранный Voice ID.');
  return { voiceId, voiceName: typeof voice.name === 'string' ? voice.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) : voiceId,
    tier, remainingCharacters: Math.max(0, limit - used), checkedAt: new Date().toISOString() };
}
