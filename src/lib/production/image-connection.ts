import { type ImageConnection } from './model';
import { limitedBytes, ProviderError } from './providers';

// Read-only account check. No prompts, image submissions or automatic retries.
export async function checkImageConnection(key: string, transport: typeof fetch = fetch): Promise<ImageConnection> {
  if (!key) throw new ProviderError('Добавьте BFL_API_KEY в .env.local и перезапустите приложение. Ключ ElevenLabs для BFL не подходит.');
  let headers: Headers;
  try { headers = new Headers({ 'x-key': key }); }
  catch { throw new ProviderError('Неверный формат BFL_API_KEY. Вставьте сам ключ без переносов строк и пояснений; не отправляйте его в чат.'); }
  let response: Response;
  try {
    response = await transport('https://api.bfl.ai/v1/credits', {
      method: 'GET', headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ProviderError('BFL: не удалось получить ответ API. Проверьте соединение приложения; системный прокси браузера может не действовать на Node.js. Изображения не создавались.');
  }
  try {
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403 ? 'Проверьте ключ именно из кабинета BFL и права доступа.'
        : response.status === 402 ? 'Проверьте баланс и биллинг в кабинете BFL.'
        : response.status === 429 ? 'Превышен лимит запросов. Повторите проверку позже вручную.'
        : response.status >= 500 ? 'Сервис временно не выполнил запрос. Повторите проверку позже вручную.'
        : 'API отклонил запрос проверки баланса. Проверьте настройки кабинета BFL.';
      throw new ProviderError(`BFL: HTTP ${response.status}. ${hint} Изображения не создавались.`);
    }
    let value: unknown;
    try { value = JSON.parse((await limitedBytes(response, 16000)).toString('utf8')); }
    catch { throw new ProviderError('BFL вернул нечитаемые сведения о балансе. Изображения не создавались.'); }
    if (!value || typeof value !== 'object' || !('credits' in value) || typeof value.credits !== 'number' || !Number.isFinite(value.credits) || value.credits < 0) {
      throw new ProviderError('BFL не вернул корректный баланс кредитов. Проверьте кабинет сервиса; изображения не создавались.');
    }
    return { credits: value.credits, checkedAt: new Date().toISOString() };
  } finally { await response.body?.cancel().catch(() => {}); }
}
