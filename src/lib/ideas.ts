import type { ChannelProfile } from "./channel";
import { projectLimits } from "./projects/validation";

export type Idea = { title: string; topic: string; genre: string; style: string };
export type IdeaRequest = { seed: string; language: string; duration: number; channel: ChannelProfile | null };
export type IdeaResult = { ideas: Idea[]; source: "test" | "yandex"; tokens?: number; error?: never } | { error: string; ideas?: never; source?: never; tokens?: never };

export function validateIdeaRequest(seed: unknown, language: unknown, duration: unknown) {
  if (typeof seed !== "string" || !seed.trim() || seed.trim().length > 1000) return null;
  if (typeof language !== "string" || !["ru", "en"].includes(language)) return null;
  if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 300) return null;
  return { seed: seed.trim(), language, duration };
}

export function parseIdeas(content: string): Idea[] {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || !("ideas" in value) || !Array.isArray(value.ideas) || value.ideas.length !== 3) throw new Error("Expected three ideas");
  return value.ideas.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid idea");
    const row = item as Record<string, unknown>;
    const idea = {} as Idea;
    for (const field of ["title", "topic", "genre", "style"] as const) {
      const text = row[field];
      // A brief should stay compact, even though projects allow a longer topic.
      const max = field === "topic" ? 1200 : projectLimits[field];
      if (typeof text !== "string" || !text.trim() || text.trim().length > max) throw new Error("Invalid idea field");
      idea[field] = text.trim();
    }
    return idea;
  });
}

export function testIdeas(request: IdeaRequest): Idea[] {
  const en = request.language === "en";
  const seed = request.seed.slice(0, 75);
  const angles = en ? ["How it works", "What changed", "A common misconception"] : ["Как это работает", "Что изменилось", "Распространённое заблуждение"];
  return angles.map(angle => ({
    title: `${angle}: ${seed}`,
    topic: en
      ? `TEST TEMPLATE. Topic as entered: ${request.seed}. Angle: ${angle}. Explain one idea, add an example and check factual claims. Audience: ${request.channel?.audience ?? "general audience"}. This is a draft structure, not researched facts.`
      : `ТЕСТОВЫЙ ШАБЛОН. Тема: ${request.seed}. Подход: ${angle}. Объясните одну мысль, добавьте пример и проверьте факты. Аудитория: ${request.channel?.audience ?? "широкая аудитория"}. Это структура замысла, не исследование фактов.`,
    genre: request.channel?.format ?? (en ? "Explainer" : "Объяснение"),
    style: request.channel?.tone ?? (en ? "Clear and calm" : "Просто и спокойно"),
  })).map(idea => ({ ...idea, topic: idea.topic.slice(0, 1200) }));
}
