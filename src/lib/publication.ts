import type { ScriptBrief } from './scripts/test-generator';

export const publicationLimits = { title: 100, description: 5000, titles: 3 } as const;
export type PublicationDraft = { title: string; titles: string[]; description: string; source: 'manual' | 'test' | 'yandex' };
export const emptyPublication: PublicationDraft = { title: '', titles: [], description: '', source: 'manual' };
export const publicationColumns = 'script_version_id,title,titles,description,source';
export const publicationMigrationMessage = 'Для материалов публикации выполните миграцию 202610150004_publication_materials.sql по docs/setup.md.';

// Strip identifiers and metadata supplied by the client/model.
export function publicationPayload(input: unknown): PublicationDraft | null {
 if (!input || typeof input !== 'object') return null;
 const data = input as Record<string, unknown>;
 const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
 if (!text(data.title, publicationLimits.title) || !text(data.description, publicationLimits.description)) return null;
 if (!Array.isArray(data.titles) || data.titles.length > publicationLimits.titles || !data.titles.every(title => text(title,publicationLimits.title))) return null;
 if (data.source !== 'manual' && data.source !== 'test' && data.source !== 'yandex') return null;
 return { title: data.title.trim(), titles: data.titles.map(title => title.trim()), description: data.description.trim(), source: data.source };
}

export function parsePublication(content: string): PublicationDraft {
 const data: unknown = JSON.parse(content);
 if (!data || typeof data !== 'object' || !('titles' in data) || !Array.isArray(data.titles) || data.titles.length !== 3 || !('description' in data)) throw new Error('Expected three titles and description');
 const result = publicationPayload({title:data.titles[0],titles:data.titles,description:data.description,source:'yandex'});
 if (!result || new Set(result.titles).size !== 3) throw new Error('Invalid publication material');
 return result;
}

export function testPublication(content: string, brief: ScriptBrief): PublicationDraft {
 const en = brief.language === 'en';
 const topic = brief.title.replace(/\s+/g,' ').trim().slice(0,65);
 const titles = en
  ? [`TEST: ${topic}`,`TEST: The question behind ${topic}`,`TEST: Understanding ${topic}`]
  : [`ТЕСТ: ${topic}`,`ТЕСТ: Главный вопрос — ${topic}`,`ТЕСТ: Разбираемся — ${topic}`];
 return {
  title:titles[0],titles,source:'test',
  description: en
   ? `TEST TEMPLATE — replace before publishing.\n\nExcerpt from the saved script (not a summary):\n${content.trim().slice(0,1000)}\n\nWrite a short description in your own words. Check every claim against the script and verified sources.`
   : `ТЕСТОВЫЙ ШАБЛОН — замените перед публикацией.\n\nФрагмент сохранённого сценария (не пересказ):\n${content.trim().slice(0,1000)}\n\nНапишите краткое описание своими словами. Сверьте утверждения со сценарием и проверенными источниками.`,
 };
}
