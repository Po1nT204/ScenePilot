import { submitImage, checkImage, type ProviderConfig } from './providers';
import { checkImageConnection } from './image-connection';
import { cloudflareImages } from './cloudflare-images';
import { googleImages } from './google-images';
import { type ImageProviderId, imageCatalog } from './image-catalog';
import type { ImageAdapter } from './image-adapter';

export function imageAdapter(id: ImageProviderId, config: ProviderConfig, transport: typeof fetch = fetch): ImageAdapter {
  const factories: Record<ImageProviderId, () => ImageAdapter> = {
    'cloudflare-flux2-klein9b': () => cloudflareImages(config.cloudflareAccountId || '', config.cloudflareToken || '', transport, 'cloudflare-flux2-klein9b'),
    'google-nano-banana-21': () => googleImages(config.geminiKey || '', transport),
    'cloudflare-sdxl': () => cloudflareImages(config.cloudflareAccountId || '', config.cloudflareToken || '', transport),
    'bfl-flux11': () => ({
      configured: !!config.bflKey,
      async checkConnection() {
        const result = await checkImageConnection(config.bflKey, transport);
        return { ...result, provider: 'bfl-flux11', message: 'Баланс BFL получен. Проверка не создаёт изображения и не подтверждает их качество.' };
      },
      async submit(prompt) { return { pending: true, task: await submitImage(prompt, config.bflKey, transport) }; },
      async poll(task) {
        const result = await checkImage(task.pollingUrl || '', config.bflKey, transport);
        return result.pending ? result : { ...result, extension: 'jpg' };
      },
    }),
  };
  if (!Object.hasOwn(factories, id)) throw new Error('Неизвестный модуль изображений.');
  return factories[id]();
}
export function imageAvailability(config: ProviderConfig) {
  return Object.fromEntries(Object.keys(imageCatalog).map(id => [id, imageAdapter(id as ImageProviderId, config).configured])) as Record<ImageProviderId, boolean>;
}
