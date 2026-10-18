import { limitedBytes, ProviderError } from './providers';
import { imageCatalog } from './image-catalog';
import type { ImageAdapter } from './image-adapter';

const model = imageCatalog['cloudflare-sdxl'].model;
export function cloudflareImages(accountId: string, token: string, transport: typeof fetch = fetch): ImageAdapter {
  const configured = /^[a-f0-9]{32}$/i.test(accountId) && !!token;
  async function request(path: string, body?: string) {
    if (!configured) throw new ProviderError('Для Cloudflare нужны CLOUDFLARE_ACCOUNT_ID (32 символа) и CLOUDFLARE_API_TOKEN.');
    let headers: Headers;
    try { headers = new Headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }); }
    catch { throw new ProviderError('Неверный формат CLOUDFLARE_API_TOKEN. Вставьте только токен без переносов строк.'); }
    let response: Response;
    try {
      response = await transport(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/${path}`, {
        method: body ? 'POST' : 'GET', headers, body, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(body ? 120000 : 15000),
      });
    } catch { throw new ProviderError('Cloudflare: соединение не завершено. Проверьте доступ приложения к API. Автоматического повтора нет.', !!body); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const hint = response.status === 401 || response.status === 403 ? 'Проверьте Account ID и права Workers AI Read/Edit.'
        : response.status === 429 ? 'Лимит запросов или бесплатная квота исчерпаны. Повторите позже вручную.' : 'Проверьте доступность модели и состояние аккаунта.';
      throw new ProviderError(`Cloudflare: HTTP ${response.status}. ${hint}`, !!body && (response.status >= 500 || response.status === 408));
    }
    return response;
  }
  return {
    configured,
    async checkConnection() {
      const response = await request(`models/search?search=${encodeURIComponent(model)}&per_page=100`);
      try {
        const data = JSON.parse((await limitedBytes(response, 256000)).toString('utf8'));
        if (data?.success !== true || !Array.isArray(data.result) || !data.result.some((item: { name?: string } | null) => item?.name === model)) throw new Error();
      } catch { throw new ProviderError('Cloudflare не подтвердил доступ к каталогу этой модели. Проверьте Workers AI Read и доступность SDXL. Генерация не запускалась.'); }
      finally { await response.body?.cancel().catch(() => {}); }
      return { provider: 'cloudflare-sdxl', checkedAt: new Date().toISOString(), message: 'Каталог API доступен, SDXL найден. Это не проверка генерации или остатка квоты; квоту смотрите в Cloudflare.' };
    },
    async submit(prompt) {
      const response = await request(`run/${model}`, JSON.stringify({ prompt, width: 1024, height: 576, num_steps: 20 }));
      try {
        const bytes = await limitedBytes(response, 16 * 1024 * 1024);
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new ProviderError('Cloudflare не вернул PNG-изображение. Новый запрос автоматически не отправлен.', true);
        return { pending: false, bytes, extension: 'png' };
      } finally { await response.body?.cancel().catch(() => {}); }
    },
    async poll() { throw new ProviderError('У SDXL синхронный API: проверить незавершённую задачу по ID нельзя. Автоматического повтора нет.', true); },
  };
}
