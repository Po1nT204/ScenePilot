import { scriptLimit } from '../scripts/validation';
import { countNarrationWords, narrationPace, validNarrationPace } from '../narration';
import { normalizeNarration, productionLimits, type VideoJob } from './model';

export type ScriptChapter = { number: number; start: number; end: number; text: string; words: number; estimatedSeconds: number };
// Technical production parts, not AI-authored story chapters. Offsets refer to normalized narration.
export function planScriptChapters(script: string, pace: number = narrationPace.default): ScriptChapter[] {
  if (typeof script !== 'string' || script.length > scriptLimit) throw new Error(`Сценарий должен быть не длиннее ${scriptLimit} символов.`);
  if (!validNarrationPace(pace)) throw new Error('Некорректный темп сохранённой версии.');
  const text = normalizeNarration(script), words = [...text.matchAll(/\S+/gu)];
  if (!words.length) throw new Error('Сначала сохраните непустой сценарий.');
  const chapters: ScriptChapter[] = [], maxWords = pace * 8;
  for (let from = 0; from < words.length;) {
    const start = words[from].index!;
    let to = from;
    while (to < words.length && to - from < maxWords && words[to].index! + words[to][0].length - start <= productionLimits.characters) to++;
    if (to === from) throw new Error('В сценарии есть фрагмент длиннее 5000 символов без пробелов. Разбейте его на предложения или слова.');
    if (to < words.length) {
      const minimum = from + Math.ceil((to - from) * 0.85);
      for (let i = to; i >= minimum; i--) if (/[.!?…。！？]["'»”)]*$/u.test(words[i - 1][0])) { to = i; break; }
    }
    const end = words[to - 1].index! + words[to - 1][0].length, part = text.slice(start, end), count = countNarrationWords(part);
    chapters.push({ number: chapters.length + 1, start, end, text: part, words: count, estimatedSeconds: Math.ceil(count * 60 / pace) });
    from = to;
  }
  return chapters;
}
// Keep the latest build of each part accessible alongside the latest 20 builds.
// The caller must already have filtered jobs by owner/project/version.
export function visibleVideoJobs<T extends Pick<VideoJob, 'versionId' | 'chapter'>>(jobs: T[]) {
  const seen = new Set<string>();
  return jobs.filter((job, index) => {
    const key = job.chapter ? `${job.versionId}:${job.chapter.number}` : '';
    const first = !!key && !seen.has(key); if (key) seen.add(key);
    return index < 20 || first;
  });
}
export function selectedScriptChapter(script: string, pace: number | undefined, index: unknown) {
  if (!Number.isInteger(index) || (index as number) < 0) throw new Error('Выберите часть сценария из списка.');
  const chapters = planScriptChapters(script, pace);
  if (chapters.length < 2 || (index as number) >= chapters.length) throw new Error('План частей изменился или выбранная часть не существует. Обновите страницу.');
  return { chapter: chapters[index as number], total: chapters.length, sourceCharacters: normalizeNarration(script).length };
}
