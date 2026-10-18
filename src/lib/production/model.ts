// Shared, serializable production data. No credentials or filesystem paths here.
export const productionLimits = { characters: 5000, shots: 12, prompt: 2000 } as const;
export const productionRates = { speechPerThousand: 0.08, image: 0.04, checked: '2026-10-18' } as const;
export type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
export type Asset = {
  state: 'empty' | 'requesting' | 'pending' | 'ready' | 'unknown' | 'failed';
  file?: string; requestId?: string; pollingUrl?: string; generatedPrompt?: string; requestedPrompt?: string;
};
export type VideoShot = { id: string; text: string; start: number; end: number; prompt: string; image: Asset };
export type VideoOperation = { kind: 'generate' | 'speech' | 'replace' | 'render' | 'check'; shotId?: string; budgetUSD: number; reservedUSD: number };
export type VideoJob = {
  schema: 1; id: string; ownerId: string; projectId: string; versionId: string;
  title: string; script: string; source: string; text: string; voiceId: string;
  createdAt: string; updatedAt: string; revision: number;
  status: 'draft' | 'queued' | 'running' | 'materials' | 'ready' | 'failed';
  message: string; shots: VideoShot[]; audio: Asset; alignment?: Alignment;
  output?: string; subtitles?: string; outputStale: boolean;
  operation?: VideoOperation;
  attempts: { id: string; kind: 'speech' | 'image'; shotId?: string; estimatedUSD: number; at: string }[];
};
export type VideoScope = { ownerId: string; projectId: string; versionId: string };
export type VideoSetup = { enabled: boolean; speech: boolean; images: boolean; workerOnline: boolean };
export type SpeechConnection = { voiceId: string; voiceName: string; tier: string; remainingCharacters: number; checkedAt: string };
export type VideoView = Omit<VideoJob, 'alignment' | 'ownerId'>;
export const normalizeNarration = (text: string) => text.trim().replace(/\s+/gu, ' ');
export const validVoice = (id: string) => /^[a-zA-Z0-9_-]{5,100}$/.test(id);
export function validateNarration(script: string) {
  const text = normalizeNarration(script);
  if (!text || text.length > productionLimits.characters) throw new Error(`Для первого видео нужен сценарий от 1 до ${productionLimits.characters} символов. Сохраните короткую версию сценария.`);
  return text;
}
export function planShots(script: string, count = 6): Omit<VideoShot, 'id'>[] {
  const text = validateNarration(script);
  const words = text.split(' ');
  const size = Math.ceil(words.length / Math.max(1, Math.min(productionLimits.shots, count)));
  let start = 0;
  const shots: Omit<VideoShot, 'id'>[] = [];
  for (let i = 0; i < words.length; i += size) {
    const part = words.slice(i, i + size).join(' ');
    shots.push({ text: part, start, end: start + part.length,
      prompt: `Cinematic editorial illustration, coherent realistic style, landscape composition, no text or watermark. Depict this part of the story: ${part}`.slice(0, productionLimits.prompt), image: { state: 'empty' } });
    start += part.length + 1;
  }
  return shots;
}
export const roundCost = (value: number) => Math.max(0, Math.ceil((value - 1e-10) * 10000) / 10000);
export function estimatedCost(job: Pick<VideoJob, 'text' | 'audio' | 'shots'>, kind: VideoOperation['kind'], shotId?: string) {
  if (kind === 'render' || kind === 'check') return 0;
  if (kind === 'speech') return roundCost(job.audio.file ? 0 : job.text.length / 1000 * productionRates.speechPerThousand);
  if (kind === 'replace') {
    if (!job.shots.some(s => s.id === shotId)) throw new Error('Кадр не найден.');
    return productionRates.image;
  }
  const images = job.shots.filter(s => !s.image.file && s.image.state !== 'pending').length;
  return roundCost((job.audio.file ? 0 : job.text.length / 1000 * productionRates.speechPerThousand) + images * productionRates.image);
}
export function requiredProviders(job: Pick<VideoJob, 'audio' | 'shots'>, kind: VideoOperation['kind']) {
  return {
    speech: (kind === 'generate' || kind === 'speech') && !job.audio.file,
    images: kind === 'replace' || kind === 'check' || (kind === 'generate' && job.shots.some(s => !s.image.file || s.image.state === 'pending')),
  };
}
export function assetsReady(job: Pick<VideoJob, 'audio' | 'shots' | 'alignment'>) {
  return !!job.audio.file && !!job.alignment && job.shots.every(s => !!s.image.file);
}
export function publicJob(job: VideoJob): VideoView {
  // Provider polling URLs can contain signed parameters. Keep them on the server.
  const { alignment: _alignment, ownerId: _owner, ...view } = job;
  void _alignment; void _owner;
  return { ...view, audio: { state: job.audio.state, file: job.audio.file },
    shots: job.shots.map(s => ({ ...s, image: { state: s.image.state, file: s.image.file, generatedPrompt: s.image.generatedPrompt } })) };
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
