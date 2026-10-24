import type { VideoView } from './model';

export const batchClipLimit = 120;
export const batchClipMaxBytes = 32 * 1024 * 1024;

// Include the complete build ID: a numbered clip from another build must not match.
export function flowFrameName(jobId: string, index: number) {
  return `sp-${jobId}-shot-${String(index + 1).padStart(3, '0')}`;
}
export function suggestClipShot(name: string, job: Pick<VideoView, 'id' | 'shots'>) {
  const normalized = name.toLowerCase().replace(/ \(\d+\)(?=\.mp4$)/, '');
  return job.shots.find((_, index) => `${flowFrameName(job.id, index)}.mp4` === normalized)?.id ?? '';
}
export function clipFileProblem(file: Pick<File, 'name' | 'size'>) {
  if (!/\.mp4$/i.test(file.name)) return 'Нужен MP4. Если скачали ZIP, сначала распакуйте его.';
  if (file.size < 12 || file.size > batchClipMaxBytes) return 'MP4 должен быть размером от 12 байт до 32 МиБ.';
  return '';
}
export type ClipAssignment = { key: string; file: File; shotId: string };
export function assignmentProblems(rows: ClipAssignment[], job: Pick<VideoView, 'shots'>) {
  return rows.map(row => clipFileProblem(row.file) ||
    (!job.shots.some(shot => shot.id === row.shotId) ? 'Выберите кадр.' : '') ||
    (rows.filter(other => other.shotId === row.shotId).length > 1 ? 'Этот кадр выбран для нескольких файлов.' : ''));
}

export async function uploadVideoClip(projectId: string, versionId: string, job: VideoView, shotId: string, file: File) {
  const query = new URLSearchParams({ version: versionId, revision: String(job.revision), shot: shotId });
  const response = await fetch(`/projects/${projectId}/video/clips/${job.id}?${query}`, {
    method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: file, redirect: 'error',
    signal: AbortSignal.timeout(120000),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Сервер не подтвердил загрузку. Проверьте вход в ScenePilot и состояние кадра.');
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(typeof result.error === 'string' ? result.error : 'Не удалось подтвердить загрузку клипа.');
  const next = result.job as VideoView | undefined;
  if (!next || next.id !== job.id || next.projectId !== projectId || next.versionId !== versionId ||
      !Number.isSafeInteger(next.revision) || next.revision <= job.revision || !Array.isArray(next.shots) ||
      !next.shots.find(shot => shot.id === shotId)?.clip?.file) throw new Error('Получено неполное подтверждение. Проверьте состояние кадра перед повтором.');
  return next;
}

// A failed/uncertain write stops the batch. Completed items are never replayed.
export async function importClipBatch(job: VideoView, rows: ClipAssignment[], options: {
  upload: (current: VideoView, row: ClipAssignment) => Promise<VideoView>;
  saved: (row: ClipAssignment, next: VideoView) => void;
  started: (row: ClipAssignment) => void;
  stop: () => boolean;
}) {
  if (!rows.length || rows.length > batchClipLimit || assignmentProblems(rows, job).some(Boolean)) throw new Error('Проверьте файлы и соответствие кадров.');
  let current = job, completed = 0;
  for (const row of rows) {
    if (options.stop()) return { completed, stopped: true };
    options.started(row);
    try {
      current = await options.upload(current, row);
    } catch (error) {
      return { completed, stopped: false, failedKey: row.key, error: error instanceof Error ? error.message : 'Не удалось подтвердить загрузку.' };
    }
    completed++;
    options.saved(row, current);
  }
  return { completed, stopped: false };
}
