import { randomUUID } from 'node:crypto';
import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, editJob, jobDirectory, productionRoot } from './store';
import { runProgram } from './render';
import { usesClip, type VideoScope } from './model';

export const imageUploadMaxBytes = 16 * 1024 * 1024;
export function imageFileFormat(bytes: Uint8Array) {
  if (bytes.length < 32 || bytes.length > imageUploadMaxBytes) throw new Error('Нужно изображение PNG, JPEG или WebP до 16 МиБ.');
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png_pipe';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpeg_pipe';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp_pipe';
  throw new Error('Файл не является PNG, JPEG или WebP. Переименование расширения не меняет формат.');
}
export async function normalizeUploadedImage(bytes: Uint8Array, cwd: string, file: string) {
  const format = imageFileFormat(bytes), input = `${randomUUID()}.upload`;
  try {
    await atomicWrite(join(cwd, input), bytes);
    const info = JSON.parse(await runProgram(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', format, '-i', input, '-show_entries', 'stream=width,height,codec_type', '-of', 'json'], cwd, 30000));
    const stream = info.streams?.[0];
    if (info.streams?.length !== 1 || stream.codec_type !== 'video' || !Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width < 64 || stream.height < 64 || stream.width > 4096 || stream.height > 4096) throw new Error('Нужно изображение размером от 64×64 до 4096×4096. Для ролика выбирайте горизонтальный кадр 16:9.');
    // Decode and re-encode a single raster frame. No SVG, remote URLs, metadata or new model requests.
    await runProgram(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-nostdin', '-n', '-xerror', '-protocol_whitelist', 'file,pipe', '-f', format, '-i', input,
      '-map', '0:v:0', '-frames:v', '1', '-map_metadata', '-1', '-c:v', 'png', '-threads', '1', '-update', '1', file], cwd, 30000);
    const size = (await stat(join(cwd, file))).size;
    if (!size || size > 32 * 1024 * 1024) throw new Error('Изображение после проверки превышает 32 МиБ. Выберите меньший размер.');
  } finally { await unlink(join(cwd, input)).catch(() => {}); }
}
export async function importImage(id: string, scope: VideoScope, revision: number, shotId: string, bytes: Uint8Array, root = productionRoot(), decode = normalizeUploadedImage) {
  imageFileFormat(bytes);
  return editJob(id, scope, revision, async job => {
    const shot = job.shots.find(s => s.id === shotId);
    if (!shot) throw new Error('Кадр не найден.');
    if (shot.image.pollingUrl || ['pending', 'requesting'].includes(shot.image.state)) throw new Error('Сначала завершите проверку текущей задачи изображения. Импорт не выполнен.');
    const cwd = jobDirectory(id, root), file = `${randomUUID()}.png`;
    try { await decode(bytes, cwd, file); }
    catch (error) { await unlink(join(cwd, file)).catch(() => {}); throw error; }
    shot.image = { state: 'ready', file, source: 'upload' };
    job.outputStale = !!job.output;
    job.message = usesClip(shot) ? 'Изображение добавлено. В монтаже остаётся выбранный MP4-клип; переключить материал можно на этапе «Анимация».' : 'Изображение добавлено. Озвучка сохранена; итоговый MP4 нужно собрать заново.';
  }, root);
}
