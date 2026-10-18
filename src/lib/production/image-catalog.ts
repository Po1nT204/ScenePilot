// Shared UI metadata. IDs pin a provider/model pair; never repoint an existing ID.
export const imageCatalog = {
  'cloudflare-sdxl': { label: 'Cloudflare · Stable Diffusion XL', model: '@cf/stabilityai/stable-diffusion-xl-base-1.0', estimatedUSD: 0,
    terms: 'Бесплатная Beta по тарифу на 18.10.2026. Нужен аккаунт Cloudflare и API-токен; доступность и качество проверяются отдельно.',
    setup: 'CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN', url: 'https://developers.cloudflare.com/workers-ai/models/stable-diffusion-xl-base-1.0/' },
  'bfl-flux11': { label: 'BFL · FLUX1.1 pro', model: 'flux-pro-1.1', estimatedUSD: 0.04,
    terms: 'Платный API BFL: около $0.04 за кадр. Требуется отдельный баланс BFL.',
    setup: 'BFL_API_KEY', url: 'https://dashboard.bfl.ai' },
} as const;
export type ImageProviderId = keyof typeof imageCatalog;
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
