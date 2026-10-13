export type SceneDraft = { description: string; visual_prompt: string; narration: string };
export function validScenes(value: unknown): value is SceneDraft[] {
 return Array.isArray(value) && value.length >= 1 && value.length <= 12 && value.every(scene =>
  scene && typeof scene === "object" && (["description", "visual_prompt", "narration"] as const).every(key =>
   typeof scene[key] === "string" && scene[key].trim().length > 0 && scene[key].length <= 2000));
}
// Mechanical segmentation, not semantic scene analysis or an AI response.
export function testScenes(content: string, language: string, style: string): SceneDraft[] {
 const chunks: string[] = [];
 const paragraphs = content.trim().split(/\n\s*\n/).map(part=>part.trim()).filter(Boolean);
 const useParagraphs = paragraphs.length >= 2 && paragraphs.length <= 12 && paragraphs.every(part=>part.length<=2000);
 if (useParagraphs) chunks.push(...paragraphs);
 let rest = useParagraphs ? "" : content.trim();
 while (rest.length) {
  let end = Math.min(1800, rest.length);
  if (end < rest.length) {
   const boundary = Math.max(rest.lastIndexOf("\n", end), rest.lastIndexOf(". ", end), rest.lastIndexOf(" ", end));
   if (boundary >= 1700) end = boundary + 1;
  }
  chunks.push(rest.slice(0, end).trim());
  rest = rest.slice(end).trim();
 }
 return chunks.map((narration, i) => ({
  narration,
  description: language === "en" ? `Scene ${i + 1}: ${narration.slice(0, 120)}` : `Сцена ${i + 1}: ${narration.slice(0, 120)}`,
  visual_prompt: language === "en"
   ? `TEST TEMPLATE. Style: ${style}. Illustrate this excerpt: ${narration.slice(0, 180)}. Specify subject, setting, framing and lighting before use.`
   : `ТЕСТОВЫЙ ШАБЛОН. Стиль: ${style}. Покажите эпизод по фрагменту: ${narration.slice(0, 180)}. Перед использованием уточните объект, место, план и освещение.`,
 }));
}
