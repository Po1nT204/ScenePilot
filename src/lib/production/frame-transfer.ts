import type { VideoView } from './model';
import { flowFrameName } from './flow-batch';
import { imagePrompt } from './visual-style';

export function imageFileProblem(file: Pick<File, 'name' | 'size'>) {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return 'Выберите PNG, JPEG или WebP. ZIP нужно сначала распаковать.';
  return file.size < 32 || file.size > 16 * 1024 * 1024 ? 'Изображение должно быть не больше 16 МиБ и не быть пустым.' : '';
}
// Paste reads only the file supplied by the user's paste event, never HTML/URLs or the clipboard in the background.
export function frameImageFromTransfer(files: File[], fromClipboard = false) {
  if (files.length !== 1) throw new Error(files.length ? 'Добавьте одно изображение в этот кадр. Несколько файлов можно загрузить через общий импорт.' : 'Изображение не получено. В Flow выберите «Копировать изображение», а не ссылку. Или выберите скачанный файл.');
  const file = files[0], extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  if ((file.type && !extensions[file.type]) || (fromClipboard && !extensions[file.type])) throw new Error('Поддерживаются изображения PNG, JPEG и WebP. Текст, ссылки и SVG не загружаются.');
  const result = fromClipboard ? new File([file], `pasted-frame.${extensions[file.type]}`, { type: file.type }) : file;
  const problem = imageFileProblem(result); if (problem) throw new Error(problem);
  return result;
}
export function suggestImageShot(name: string, job: Pick<VideoView, 'id' | 'shots'>) {
  const stem = name.toLowerCase().replace(/(?: \(\d+\))?\.(png|jpe?g|webp)$/i, '');
  return job.shots.find((_, i) => flowFrameName(job.id, i).toLowerCase() === stem)?.id ?? '';
}
export function framePromptForFlow(job: Pick<VideoView, 'visualStyle' | 'visualGuide'>, prompt: string) {
  return `${imagePrompt(prompt, job.visualStyle, job.visualGuide)}\nCreate one standalone 16:9 image, not a storyboard sheet or collage. Show one observable moment, with a clear subject, plausible anatomy and purposeful lighting. If reference images are supplied, preserve the recurring character's face, clothing and the established visual style.`;
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
