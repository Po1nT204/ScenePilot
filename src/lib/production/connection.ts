import { validVoice, type SpeechConnection } from './model';
import { limitedBytes, ProviderError, speechRejectionHint } from './providers';

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
        const hint = await speechRejectionHint(response, permission);
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
