import { limitedBytes, ProviderError } from './providers';
import { imageCatalog } from './image-catalog';
import type { ImageAdapter } from './image-adapter';

export function cloudflareImages(accountId: string, token: string, transport: typeof fetch = fetch, provider: 'cloudflare-sdxl' | 'cloudflare-flux2-klein9b' = 'cloudflare-sdxl'): ImageAdapter {
  const model = imageCatalog[provider].model, label = provider === 'cloudflare-sdxl' ? 'SDXL' : 'FLUX.2 klein 9B';
  const configured = /^[a-f0-9]{32}$/i.test(accountId) && !!token;
  async function request(path: string, body?: string | FormData) {
    if (!configured) throw new ProviderError('Для Cloudflare нужны CLOUDFLARE_ACCOUNT_ID (32 символа) и CLOUDFLARE_API_TOKEN.');
    let headers: Headers;
    try { headers = new Headers({ Authorization: `Bearer ${token}` }); if (!(body instanceof FormData)) headers.set('Content-Type', 'application/json'); }
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
        : response.status === 429 ? 'Лимит запросов или бесплатная квота исчерпаны. Повторите позже вручную.'
        : response.status === 402 ? 'Проверьте бесплатную квоту и тариф Workers AI в Cloudflare.' : 'Проверьте доступность модели и состояние аккаунта.';
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
      } catch { throw new ProviderError(`Cloudflare не подтвердил доступ к каталогу этой модели. Проверьте Workers AI Read и доступность ${label}. Генерация не запускалась.`); }
      finally { await response.body?.cancel().catch(() => {}); }
      return { provider, checkedAt: new Date().toISOString(), message: `Каталог API доступен, ${label} найден. Это не проверка генерации или остатка квоты; квоту смотрите в Cloudflare.` };
    },
    async submit(prompt) {
      if (provider === 'cloudflare-flux2-klein9b') {
        const body = new FormData(); body.set('prompt', prompt); body.set('width', '1280'); body.set('height', '720');
        const response = await request(`run/${model}`, body);
        try {
          const data = JSON.parse((await limitedBytes(response, 24 * 1024 * 1024)).toString('utf8'));
          const encoded = data?.result?.image;
          if (data?.success !== true || typeof encoded !== 'string' || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error();
          const bytes = Buffer.from(encoded, 'base64');
          const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
          const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
          if ((!png && !jpg) || bytes.length < 32 || bytes.length > 16 * 1024 * 1024) throw new Error();
          return { pending: false, bytes, extension: png ? 'png' : 'jpg' };
        } catch { throw new ProviderError('Cloudflare не вернул корректное изображение FLUX. Проверьте историю квоты; автоматического повтора нет.', true); }
        finally { await response.body?.cancel().catch(() => {}); }
      }
      const response = await request(`run/${model}`, JSON.stringify({ prompt, width: 1024, height: 576, num_steps: 20 }));
      try {
        const bytes = await limitedBytes(response, 16 * 1024 * 1024);
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new ProviderError('Cloudflare не вернул PNG-изображение. Новый запрос автоматически не отправлен.', true);
        return { pending: false, bytes, extension: 'png' };
      } finally { await response.body?.cancel().catch(() => {}); }
    },
    async poll() { throw new ProviderError(`У ${label} синхронный API: проверить незавершённую задачу по ID нельзя. Автоматического повтора нет.`, true); },
  };
}
