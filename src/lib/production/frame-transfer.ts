import type { VideoView } from './model';
import { flowFrameName } from './flow-batch';
import { imagePrompt } from './visual-style';

export function imageFileProblem(file: Pick<File, 'name' | 'size'>) {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return 'Выберите PNG, JPEG или WebP. ZIP нужно сначала распаковать.';
  return file.size < 32 || file.size > 16 * 1024 * 1024 ? 'Изображение должно быть не больше 16 МиБ и не быть пустым.' : '';
}
export function suggestImageShot(name: string, job: Pick<VideoView, 'id' | 'shots'>) {
  const stem = name.toLowerCase().replace(/(?: \(\d+\))?\.(png|jpe?g|webp)$/i, '');
  return job.shots.find((_, i) => flowFrameName(job.id, i).toLowerCase() === stem)?.id ?? '';
}
export function framePromptForFlow(job: Pick<VideoView, 'visualStyle'>, prompt: string) {
  return `${imagePrompt(prompt, job.visualStyle)}\nCreate one standalone 16:9 image, not a storyboard sheet or collage. Show one observable moment, with a clear subject, plausible anatomy and purposeful lighting. If reference images are supplied, preserve the recurring character's face, clothing and the established visual style.`;
}
export async function uploadFrameImage(projectId: string, versionId: string, job: VideoView, shotId: string, file: File) {
  const problem = imageFileProblem(file); if (problem) throw new Error(problem);
  const query = new URLSearchParams({ version: versionId, revision: String(job.revision), shot: shotId });
  const response = await fetch(`/projects/${projectId}/video/images/${job.id}?${query}`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' }, redirect: 'error', signal: AbortSignal.timeout(150000) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Сервер не подтвердил загрузку. Проверьте вход и состояние кадра.');
  const result = await response.json();
  if (!response.ok || result?.error) throw new Error(typeof result?.error === 'string' ? result.error : 'Не удалось сохранить изображение.');
  const next = result?.job as VideoView | undefined, image = next?.shots?.find(s => s.id === shotId)?.image;
  if (!next || next.id !== job.id || next.projectId !== projectId || next.versionId !== versionId || !Number.isSafeInteger(next.revision) || next.revision <= job.revision ||
      !image?.file || image.source !== 'upload' || image.file === job.shots.find(s => s.id === shotId)?.image.file) throw new Error('Получено неполное подтверждение. Проверьте состояние кадра перед повтором.');
  return next;
}
