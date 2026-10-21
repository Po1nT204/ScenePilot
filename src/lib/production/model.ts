// Shared, serializable production data. No credentials or filesystem paths here.
import { imagePrice, selectedImageProvider, type ImageSelection, type ImageProviderId } from './image-catalog';
import type { VisualStyle } from './visual-style';
export const productionLimits = { characters: 5000, shots: 12, prompt: 2000 } as const;
export const productionRates = { speechPerThousand: 0.08, image: 0.04, checked: '2026-10-21' } as const;
export type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
export type Asset = {
  state: 'empty' | 'requesting' | 'pending' | 'ready' | 'unknown' | 'failed';
  file?: string; requestId?: string; pollingUrl?: string; generatedPrompt?: string; requestedPrompt?: string;
  provider?: ImageProviderId; requestedProvider?: ImageProviderId;
};
export type ClipTail = 'hold' | 'loop' | 'auto';
export type VideoShot = { id: string; text: string; start: number; end: number; prompt: string; image: Asset; visual?: 'image' | 'clip'; clip?: { file: string; duration: number; source: 'upload'; tail: ClipTail } };
export const usesClip = (shot: VideoShot) => shot.visual === 'clip' && !!shot.clip?.file;
export const hasVisual = (shot: VideoShot) => shot.visual === 'clip' ? !!shot.clip?.file : !!shot.image.file;
export type VideoOperation = { kind: 'generate' | 'speech' | 'replace' | 'render' | 'check'; shotId?: string; budgetUSD: number; reservedUSD: number };
export type VideoJob = {
  schema: 1; id: string; ownerId: string; projectId: string; versionId: string;
  title: string; script: string; source: string; text: string; voiceId: string;
  createdAt: string; updatedAt: string; revision: number;
  status: 'draft' | 'queued' | 'running' | 'materials' | 'ready' | 'failed';
  message: string; shots: VideoShot[]; audio: Asset; alignment?: Alignment;
  imageProvider?: ImageSelection;
  visualStyle?: VisualStyle;
  subtitlesEnabled?: boolean;
  storyboardFrom?: { id: string; revision: number; target: number };
  output?: string; subtitles?: string; outputStale: boolean;
  operation?: VideoOperation;
  attempts: { id: string; kind: 'speech' | 'image'; shotId?: string; provider?: ImageProviderId; model?: string; estimatedUSD: number; at: string }[];
};
export type VideoScope = { ownerId: string; projectId: string; versionId: string };
export type VideoSetup = { enabled: boolean; speech: boolean; images: boolean; imageProviders?: Partial<Record<ImageProviderId, boolean>>; workerOnline: boolean };
export type SpeechConnection = { voiceId: string; voiceName: string; tier: string; remainingCharacters: number; checkedAt: string };
export type ImageConnection = { credits: number; checkedAt: string };
export type ShotTiming = { start: number; end: number };
export type VideoView = Omit<VideoJob, 'alignment' | 'ownerId'> & { shotTimings?: Record<string, ShotTiming> };
export const normalizeNarration = (text: string) => text.trim().replace(/\s+/gu, ' ');
export const validVoice = (id: string) => /^[a-zA-Z0-9_-]{5,100}$/.test(id);
export function validateNarration(script: string) {
  const text = normalizeNarration(script);
  if (!text || text.length > productionLimits.characters) throw new Error(`Для первого видео нужен сценарий от 1 до ${productionLimits.characters} символов. Сохраните короткую версию сценария.`);
  return text;
}
export function planShots(script: string, count = 6): Omit<VideoShot, 'id'>[] {
  const text = validateNarration(script);
  const target = Number.isFinite(count) ? Math.max(1, Math.min(productionLimits.shots, Math.floor(count))) : 6;
  // Prefer complete sentences. Long unpunctuated passages can still split at words.
  const units: string[] = [];
  for (const sentence of new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)) {
    let part = '';
    for (const word of sentence.segment.trim().split(' ')) {
      if (part && part.length + word.length + 1 > 900) { units.push(part); part = ''; }
      part += (part ? ' ' : '') + word;
    }
    if (part) units.push(part);
  }
  const groups: string[] = [];
  let group = '';
  let consumed = 0;
  for (let i = 0; i < units.length; i++) {
    group += (group ? ' ' : '') + units[i];
    const remainingGroups = Math.min(target - groups.length, units.length - i + (group ? 0 : 1));
    const desired = (text.length - consumed) / Math.max(1, remainingGroups);
    if (i === units.length - 1 || (groups.length < target - 1 &&
      (units.length - i - 1 <= target - groups.length - 1 || Math.abs(group.length - desired) <= Math.abs(group.length + 1 + units[i + 1].length - desired)))) {
      groups.push(group); consumed += group.length + 1; group = '';
    }
  }
  let start = 0;
  const shots: Omit<VideoShot, 'id'>[] = [];
  for (const part of groups) {
    shots.push({ text: part, start, end: start + part.length,
      prompt: `Cinematic editorial illustration, coherent realistic style, landscape composition, no text or watermark. Depict this part of the story: ${part}`.slice(0, productionLimits.prompt), image: { state: 'empty' } });
    start += part.length + 1;
  }
  return shots;
}
export const roundCost = (value: number) => Math.max(0, Math.ceil((value - 1e-10) * 10000) / 10000);
export function estimatedCost(job: Pick<VideoJob, 'text' | 'audio' | 'shots' | 'imageProvider'>, kind: VideoOperation['kind'], shotId?: string) {
  if (kind === 'render' || kind === 'check') return 0;
  if (kind === 'speech') return roundCost(job.audio.file ? 0 : job.text.length / 1000 * productionRates.speechPerThousand);
  if (kind === 'replace') {
    if (!job.shots.some(s => s.id === shotId)) throw new Error('Кадр не найден.');
    return imagePrice(job);
  }
  const images = job.shots.filter(s => !hasVisual(s) && s.image.state !== 'pending').length;
  return roundCost((job.audio.file ? 0 : job.text.length / 1000 * productionRates.speechPerThousand) + images * imagePrice(job));
}
export function createsImages(job: Pick<VideoJob, 'shots'>, kind: VideoOperation['kind']) {
  return kind === 'replace' || (kind === 'generate' && job.shots.some(s => !hasVisual(s) && s.image.state !== 'pending'));
}
export function createsMaterials(job: Pick<VideoJob, 'shots' | 'audio'>, kind: VideoOperation['kind']) {
  return createsImages(job, kind) || ((kind === 'generate' || kind === 'speech') && !job.audio.file);
}
export function neededImageProviders(job: Pick<VideoJob, 'shots' | 'imageProvider'>, kind: VideoOperation['kind']) {
  const ids = new Set<ImageProviderId>();
  const selected = selectedImageProvider(job);
  if (createsImages(job, kind) && selected !== 'none') ids.add(selected);
  if (kind === 'generate' || kind === 'check') for (const shot of job.shots) {
    if (shot.image.state === 'pending' || shot.image.pollingUrl) ids.add(shot.image.requestedProvider || shot.image.provider || 'bfl-flux11');
  }
  return [...ids];
}
export function requiredProviders(job: Pick<VideoJob, 'audio' | 'shots'>, kind: VideoOperation['kind']) {
  return {
    speech: (kind === 'generate' || kind === 'speech') && !job.audio.file,
    images: kind === 'replace' || kind === 'check' || (kind === 'generate' && job.shots.some(s => !hasVisual(s) || s.image.state === 'pending')),
  };
}
export function assetsReady(job: Pick<VideoJob, 'audio' | 'shots' | 'alignment'>) {
  return !!job.audio.file && !!job.alignment && job.shots.every(hasVisual);
}
export function publicJob(job: VideoJob): VideoView {
  // Provider polling URLs can contain signed parameters. Keep them on the server.
  const { alignment: _alignment, ownerId: _owner, ...view } = job;
  void _alignment; void _owner;
  return { ...view, shotTimings: job.alignment ? shotTimings(job, job.alignment.character_end_times_seconds.at(-1)!) : undefined, audio: { state: job.audio.state, file: job.audio.file },
    shots: job.shots.map(s => ({ ...s, image: { state: s.image.state, file: s.image.file, generatedPrompt: s.image.generatedPrompt, provider: s.image.provider, requestedProvider: s.image.requestedProvider } })) };
}
// Character boundaries come from the saved TTS alignment, not a words/minute guess.
// The public view ends at the last spoken character; render includes the audio file's trailing silence.
export function shotTimings(job: Pick<VideoJob, 'shots' | 'alignment'>, duration: number): Record<string, ShotTiming> {
  if (!job.alignment) throw new Error('Сначала создайте озвучку с таймингами.');
  return Object.fromEntries(job.shots.map((shot, i) => {
    const start = i === 0 ? 0 : job.alignment!.character_start_times_seconds[shot.start];
    const end = i + 1 < job.shots.length ? job.alignment!.character_start_times_seconds[job.shots[i + 1].start] : duration;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('Некорректная длительность кадра.');
    return [shot.id, { start, end }];
  }));
}
export function parseAlignment(value: unknown, text: string): Alignment {
  const a = value as Alignment | null;
  if (!a || !Array.isArray(a.characters) || !a.characters.every(c => typeof c === 'string' && c.length === 1) || a.characters.join('') !== text ||
      !Array.isArray(a.character_start_times_seconds) || !Array.isArray(a.character_end_times_seconds) ||
      a.character_start_times_seconds.length !== text.length || a.character_end_times_seconds.length !== text.length) throw new Error('Озвучка получена без подходящей разметки текста. Новый запрос автоматически не отправлен.');
  let previousStart = 0, previousEnd = 0;
  a.characters.forEach((_, i) => {
    const start = a.character_start_times_seconds[i], end = a.character_end_times_seconds[i];
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousStart || end < start || end < previousEnd || end > 900) throw new Error('Провайдер вернул некорректные тайминги.');
    previousStart = start; previousEnd = end;
  });
  if (previousEnd <= 0) throw new Error('Озвучка имеет нулевую длительность.');
  return a;
}
function srtTime(seconds: number) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function makeSubtitles(text: string, value: Alignment) {
  const a = parseAlignment(value, text);
  const words = [...text.matchAll(/\S+/gu)];
  const cues: string[] = [];
  for (let i = 0; i < words.length;) {
    const first = words[i].index!;
    let last = first, line = '';
    while (i < words.length) {
      const word = words[i], end = word.index! + word[0].length - 1;
      if (line && (line.length + word[0].length > 62 || a.character_end_times_seconds[end] - a.character_start_times_seconds[first] > 4)) break;
      line += (line ? ' ' : '') + word[0]; last = end; i++;
    }
    const start = a.character_start_times_seconds[first], end = a.character_end_times_seconds[last];
    if (end <= start) continue;
    // SRT is interpreted by libass; do not allow narration to become styling commands.
    line = line.replace(/[{}<>\\]/g, '');
    if (line.length > 36) {
      const split = line.lastIndexOf(' ', Math.ceil(line.length / 2) + 7);
      if (split > 0) line = line.slice(0, split) + '\n' + line.slice(split + 1);
    }
    cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${line}`);
  }
  return cues.join('\n\n') + '\n';
}
