import { limitedBytes, ProviderError } from './providers';
import { imageCatalog } from './image-catalog';
import type { ImageAdapter } from './image-adapter';

const provider = 'google-nano-banana-21';
const model = imageCatalog[provider].model;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function googleImages(key: string, transport: typeof fetch = fetch): ImageAdapter {
  async function request(path: string, body?: string) {
    if (!key) throw new ProviderError('Для Nano Banana нужен GEMINI_API_KEY и отдельный биллинг Gemini API.');
    let headers: Headers;
    try { headers = new Headers({ 'x-goog-api-key': key, 'Content-Type': 'application/json' }); }
    catch { throw new ProviderError('GEMINI_API_KEY содержит недопустимые символы.'); }
    let response: Response;
    try { response = await transport(`https://generativelanguage.googleapis.com/v1beta/${path}`, {
      method: body ? 'POST' : 'GET', headers, body, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(body ? 120000 : 15000),
    }); } catch { throw new ProviderError('Google: соединение прервано. Проверьте доступ к API. Автоматического повтора нет.', !!body); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ProviderError(`Google: HTTP ${response.status}. Проверьте API-ключ, регион, доступ к модели и отдельный биллинг Gemini API. Подписка Google Pro не оплачивает API.`, !!body && (response.status >= 500 || response.status === 408));
    }
    try { return record(JSON.parse((await limitedBytes(response, body ? 24 * 1024 * 1024 : 256000)).toString('utf8'))); }
    catch { throw new ProviderError('Google вернул нечитаемый или слишком большой ответ. Автоматического повтора нет.', !!body); }
    finally { await response.body?.cancel().catch(() => {}); }
  }
  return {
    configured: !!key,
    async checkConnection() {
      const data = await request(`models/${model}`);
      if (data.name !== `models/${model}`) throw new ProviderError('Google не подтвердил доступ к каталогу Nano Banana. Генерация не запускалась.');
      return { provider, checkedAt: new Date().toISOString(), message: 'Модель найдена в API. Это не проверка генерации, баланса или доступной квоты.' };
    },
    async submit(prompt) {
      const data = await request('interactions', JSON.stringify({ model, input: [{ type: 'text', text: prompt }],
        response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '16:9', image_size: '1K' },
        store: false, stream: false, background: false, generation_config: { max_output_tokens: 4096 },
      }));
      const contents = (Array.isArray(data.steps) ? data.steps : []).map(record)
        .filter(step => step.type === 'model_output').flatMap(step => Array.isArray(step.content) ? step.content : []).map(record);
      const images = contents.filter(item => item.type === 'image');
      const img = images[0];
      if (data.status !== 'completed' || images.length !== 1 || typeof img?.data !== 'string' ||
          (img.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(img.data))) {
        throw new ProviderError('Google не вернул одно завершённое изображение. Проверьте историю расходов; новый запрос автоматически не отправлен.', true);
      }
      const bytes = Buffer.from(img.data, 'base64');
      const png = img.mime_type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpg = img.mime_type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if ((!png && !jpg) || bytes.length < 32 || bytes.length > 16 * 1024 * 1024) throw new ProviderError('Google вернул неподдерживаемое изображение. Повтор не выполнялся.', true);
      return { pending: false, bytes, extension: png ? 'png' : 'jpg' };
    },
    async poll() { throw new ProviderError('Nano Banana работает синхронно. Неопределённый запрос не повторяется автоматически; проверьте расходы в Google.', true); },
  };
}
