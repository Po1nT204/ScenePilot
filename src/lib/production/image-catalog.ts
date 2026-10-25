// Shared UI metadata. IDs pin a provider/model pair; never repoint an existing ID.
export const imageCatalog = {
  'cloudflare-flux2-klein9b': { label: 'Cloudflare · FLUX.2 klein 9B', model: '@cf/black-forest-labs/flux-2-klein-9b', estimatedUSD: 0.015,
    terms: '1280×720. Общая бесплатная квота Workers AI — 10 000 нейронов в день. Кадр до 1 Мп: около 1364 нейронов (≈ $0.015 сверх квоты на Paid). На Free превышение квоты останавливает запросы. Остаток и тариф проверяйте в Cloudflare.',
    setup: 'Те же CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN', url: 'https://developers.cloudflare.com/workers-ai/platform/pricing/' },
  'google-nano-banana-21': { label: 'Google · Nano Banana 2.1', model: 'gemini-nano-banana-2.1', estimatedUSD: 0.08,
    terms: 'Платный Gemini API, отдельно от Google Pro/Flow. 1K, 16:9. Оценка $0.08 за запрос; фактическая цена зависит от токенов. Бесплатного API-тарифа нет.',
    setup: 'GEMINI_API_KEY', url: 'https://aistudio.google.com/api-keys' },
  'cloudflare-sdxl': { label: 'Cloudflare · Stable Diffusion XL', model: '@cf/stabilityai/stable-diffusion-xl-base-1.0', estimatedUSD: 0,
    terms: 'Бесплатная Beta по тарифу на 18.10.2026. Нужен аккаунт Cloudflare и API-токен; доступность и качество проверяются отдельно.',
    setup: 'CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN', url: 'https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-base-1.0/' },
  'bfl-flux11': { label: 'BFL · FLUX1.1 pro', model: 'flux-pro-1.1', estimatedUSD: 0.04,
    terms: 'Платный API BFL: около $0.04 за кадр. Требуется отдельный баланс BFL.',
    setup: 'BFL_API_KEY', url: 'https://dashboard.bfl.ai' },
} as const;
export type ImageProviderId = keyof typeof imageCatalog;
export function imageBillingLabel(id: ImageProviderId) {
  return id === 'cloudflare-flux2-klein9b' ? 'бесплатная квота / платный перерасход' : imageCatalog[id].estimatedUSD === 0 ? 'бесплатная Beta' : 'платный API';
}
export type ImageSelection = ImageProviderId | 'none';
export function isImageProvider(value: unknown): value is ImageProviderId {
  return typeof value === 'string' && Object.hasOwn(imageCatalog, value);
}
export function validImageSelection(value: unknown): value is ImageSelection { return value === 'none' || isImageProvider(value); }
// Old schema-1 jobs were exclusively BFL; new jobs explicitly store 'none'.
export function selectedImageProvider(job: { imageProvider?: ImageSelection }): ImageSelection { return job.imageProvider ?? 'bfl-flux11'; }
export function imagePrice(job: { imageProvider?: ImageSelection }) {
  const id = selectedImageProvider(job); return id === 'none' ? 0 : imageCatalog[id].estimatedUSD;
}
