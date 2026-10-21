import { hasVisual, parseAlignment, shotTimings, type VideoJob, type VideoShot } from './model';

export const storyboardTargets = [6, 8, 10, 15] as const;
export const storyboardLimit = 120;
export type StoryboardSummary = { before: number; after: number; missing: number; retained: number; longest: number };

// Mechanical word/sentence boundaries, not a semantic model or a new TTS request.
export function timedStoryboard(job: VideoJob, target: number) {
  if (!(storyboardTargets as readonly number[]).includes(target)) throw new Error('Выберите длительность 6, 8, 10 или 15 секунд.');
  if (job.status === 'queued' || job.status === 'running') throw new Error('Дождитесь завершения текущего действия.');
  if (job.audio.state !== 'ready' || !job.audio.file) throw new Error('Сначала создайте озвучку.');
  if (job.shots.some(s => s.image.pollingUrl || ['pending', 'requesting', 'unknown'].includes(s.image.state))) throw new Error('Сначала разберите незавершённые запросы изображений.');
  const a = parseAlignment(job.alignment, job.text);
  const duration = a.character_end_times_seconds.at(-1)!;
  const originalTimes = shotTimings(job, duration);
  const shots: VideoShot[] = [];
  let previousEnd = 0;
  for (const [index, source] of job.shots.entries()) {
    if (!Number.isInteger(source.start) || !Number.isInteger(source.end) || source.start < previousEnd || source.end <= source.start ||
        source.end > job.text.length || job.text.slice(source.start, source.end) !== source.text || job.text.slice(previousEnd, source.start).trim()) throw new Error('Раскадровка не соответствует озвученному тексту.');
    previousEnd = source.end;
    const starts = [...source.text.matchAll(/\S+/gu)].map(m => source.start + m.index!);
    let cursor = source.start, part = 0;
    while (cursor < source.end) {
      const time = index === 0 && part === 0 ? 0 : a.character_start_times_seconds[cursor];
      let next = source.end;
      if (originalTimes[source.id].end - time > target) {
        const candidates = starts.filter(pos => pos > cursor && a.character_start_times_seconds[pos] > time && a.character_start_times_seconds[pos] <= time + target);
        const sentences = candidates.filter(pos => a.character_start_times_seconds[pos] >= time + target * 0.65 && /[.!?…]["'»”)]*\s*$/u.test(job.text.slice(cursor, pos)));
        next = sentences.at(-1) ?? candidates.at(-1) ?? starts.find(pos => pos > cursor && a.character_start_times_seconds[pos] > time) ?? source.end;
      }
      const text = job.text.slice(cursor, next).trimEnd();
      if (!text) throw new Error('Пустой фрагмент раскадровки.');
      const first = part === 0;
      shots.push({ ...source, id: `${source.id}:${part}`, start: cursor, end: cursor + text.length, text,
        prompt: first ? source.prompt : `Cinematic editorial illustration, landscape, no text or watermark. Depict: ${text}`.slice(0, 1600),
        image: first && source.image.file ? { state: 'ready', file: source.image.file, provider: source.image.provider, generatedPrompt: source.image.generatedPrompt } : { state: 'empty' },
        clip: first && source.clip ? { ...source.clip } : undefined, visual: first ? source.visual : 'image',
      });
      if (shots.length > storyboardLimit) throw new Error(`Получается больше ${storyboardLimit} кадров. Выберите большую длительность.`);
      cursor = next; part++;
    }
  }
  if (!shots.length || job.text.slice(previousEnd).trim()) throw new Error('Раскадровка не покрывает весь текст.');
  const times = shotTimings({ shots, alignment: a }, duration);
  const retained = shots.filter(hasVisual).length;
  const summary: StoryboardSummary = { before: job.shots.length, after: shots.length, missing: shots.length - retained, retained,
    longest: Math.max(...Object.values(times).map(t => t.end - t.start)) };
  return { shots, summary };
}
