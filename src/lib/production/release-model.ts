import type { VideoJob, VideoScope } from './model';
import { normalizeNarration } from './model';
import { planScriptChapters, type ScriptChapter } from './chapters';

export type ReleaseInput = { jobId: string; revision: number; output: string; number: number };
export type VideoRelease = VideoScope & {
  schema: 1; id: string; createdAt: string; updatedAt: string;
  status: 'queued' | 'running' | 'ready' | 'failed'; message: string;
  inputs: ReleaseInput[]; output?: string; duration?: number;
};
export type ReleaseView = Omit<VideoRelease, 'ownerId'> & { stale: boolean };
export type ReleaseChoice = { id: string; revision: number; createdAt: string; ready: boolean; reason: string; voiceId: string; subtitles: boolean };
export type ReleasePart = { number: number; choices: ReleaseChoice[] };

export function matchesChapter(job: VideoJob, part: ScriptChapter, total: number, script: string) {
  const chapter = job.chapter;
  return !!chapter && chapter.number === part.number && chapter.total === total && chapter.start === part.start && chapter.end === part.end &&
    chapter.sourceCharacters === normalizeNarration(script).length && normalizeNarration(job.versionScript ?? '') === normalizeNarration(script) && job.text === part.text;
}
export function releasePartProblem(job: Pick<VideoJob, 'status' | 'output' | 'outputStale'>) {
  if (job.status === 'queued' || job.status === 'running') return 'В обработке';
  if (!job.output) return 'Сначала соберите MP4 части';
  if (job.outputStale) return 'Пересоберите MP4: материалы изменены';
  return '';
}
// Only owner-scoped jobs may be passed here. Invalid/short scripts have no release panel.
export function releaseParts(jobs: VideoJob[], script: string, pace?: number): ReleasePart[] {
  let plan: ScriptChapter[];
  try { plan = planScriptChapters(script, pace); } catch { return []; }
  if (plan.length < 2) return [];
  return plan.map(part => ({ number: part.number, choices: jobs.filter(job => matchesChapter(job, part, plan.length, script)).map(job => {
    const reason = releasePartProblem(job);
    return { id: job.id, revision: job.revision, createdAt: job.createdAt, ready: !reason, reason, voiceId: job.voiceId, subtitles: job.subtitlesEnabled ?? true };
  }) }));
}
export function publicRelease(release: VideoRelease, jobs: VideoJob[]): ReleaseView {
  const { ownerId: _owner, ...view } = release; void _owner;
  const stale = release.inputs.some(input => {
    const job = jobs.find(job => job.id === input.jobId);
    return !job || job.output !== input.output || job.outputStale;
  });
  return { ...view, stale };
}
