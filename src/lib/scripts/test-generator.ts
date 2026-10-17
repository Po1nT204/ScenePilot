import type { ChannelProfile } from "../channel";
export type ScriptBrief = {
 title: string;
 topic: string;
 genre: string;
 style: string;
 language: string;
 target_duration_seconds: number;
 channel?: ChannelProfile | null;
 narration_pace?: number;
};

// A deterministic fixture for testing the workflow, not a language model.
export function generateTestScript(brief: ScriptBrief): string {
 if (brief.language === "en") return [
  "[TEST EXAMPLE — template, not AI-generated]",
  `Title: ${brief.title}`,
  `Topic (as entered): ${brief.topic}`,
  `Genre: ${brief.genre}. Style: ${brief.style}. Target duration: ${brief.target_duration_seconds} seconds.`,
  "OPENING\nIntroduce the topic above. Ask the viewer what they would like to understand about it.",
  "MAIN PART\nExplain one key idea about the topic in plain language. Add a concrete example and verify any factual claims before recording.",
  "ENDING\nSummarize the key idea and suggest one practical next step for the viewer.",
  "This is a test outline. Replace the instructions with narration. Timing is not calculated; project text is not translated.",
 ].join("\n\n");
 return [
  "[ТЕСТОВЫЙ ПРИМЕР — шаблон, не результат работы ИИ]",
  `Название: ${brief.title}`,
  `Тема: ${brief.topic}`,
  `Жанр: ${brief.genre}. Стиль: ${brief.style}. Целевая длительность: ${brief.target_duration_seconds} сек.`,
  "ВСТУПЛЕНИЕ\nПредставьте указанную выше тему. Задайте зрителю вопрос: что он хотел бы понять об этом?",
  "ОСНОВНАЯ ЧАСТЬ\nОбъясните одну ключевую мысль по теме простыми словами. Приведите конкретный пример. Перед записью проверьте фактические утверждения.",
  "ЗАВЕРШЕНИЕ\nКратко повторите основную мысль и предложите зрителю один практический следующий шаг.",
  "Это тестовая заготовка. Замените инструкции текстом озвучки. Хронометраж не рассчитан; жанр и стиль указаны как ориентиры для автора.",
 ].join("\n\n");
}

export type GenerationResult = { content: string; tokens?: number; error?: never } | { error: string; content?: never; tokens?: never };
