// Shared prompt settings; independent of the image provider.
export const visualStyles = {
  original: { label: 'Как в описании кадра', prompt: '' },
  photo: { label: 'Документальная фотография', prompt: 'Documentary photograph, natural available light, realistic textures and proportions, restrained color grading, candid composition. Avoid CGI, plastic skin, excessive gloss and artificial HDR.' },
  cinema: { label: 'Кинокадр', prompt: 'Live-action film still, motivated cinematic lighting, believable materials and anatomy, restrained color palette, deliberate composition. Avoid CGI rendering, excessive saturation and artificial gloss.' },
  illustration: { label: 'Редакционная иллюстрация', prompt: 'Editorial illustration, deliberate simplified shapes, cohesive limited color palette, clear visual hierarchy, textured painted surfaces. Not photorealistic.' },
} as const;
export type VisualStyle = keyof typeof visualStyles;
export const visualGuideLimit = 800;
export function normalizeVisualGuide(value: unknown) {
  if (typeof value !== 'string' || value.length > visualGuideLimit) throw new Error(`Общие детали кадров: не больше ${visualGuideLimit} символов.`);
  return value.trim();
}
export function validVisualStyle(value: unknown): value is VisualStyle {
  return typeof value === 'string' && Object.hasOwn(visualStyles, value);
}
export function imagePrompt(prompt: string, style: VisualStyle = 'original', visualGuide = '') {
  if (!validVisualStyle(style)) throw new Error('Неизвестный визуальный стиль.');
  // Legacy descriptions contain a fixed, conflicting illustration style.
  const subject = prompt.replace(/^Cinematic editorial illustration, coherent realistic style, landscape composition, no text or watermark\. Depict this part of the story: /, '');
  const base = style === 'original' ? prompt : `${visualStyles[style].prompt}\nScene: ${subject}\nLandscape 16:9 composition. No captions, lettering, logos or watermark.`;
  const guide = normalizeVisualGuide(visualGuide);
  return guide ? `${base}\nContinuity notes for this story (apply only to characters and places present in this scene; do not add absent characters or override the scene's action):\n${guide}` : base;
}
