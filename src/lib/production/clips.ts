import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, editJob, jobDirectory, productionRoot } from './store';
import { runProgram } from './render';
import type { ClipTail, VideoJob, VideoScope } from './model';

export const clipMaxBytes = 32 * 1024 * 1024;
export function selectVisual(job: VideoJob, shotId: string, visual: string, tail: string) {
  const shot = job.shots.find(s => s.id === shotId);
  if (!shot || !['image', 'clip'].includes(visual) || !['hold', 'loop', 'auto'].includes(tail)) throw new Error('Некорректный выбор материала.');
  if (visual === 'clip' && !shot.clip) throw new Error('Сначала добавьте MP4-клип.');
  shot.visual = visual as 'image' | 'clip';
  if (shot.clip) shot.clip.tail = tail as ClipTail;
  job.outputStale = !!job.output;
  job.message = 'Материал сцены сохранён. Соберите MP4 заново; генерация не запускалась.';
}
export function fitAllClips(job: VideoJob) {
  if (!job.shots.some(shot => shot.clip)) throw new Error('Сначала добавьте хотя бы один клип.');
  for (const shot of job.shots) if (shot.clip) shot.clip.tail = 'auto';
  job.outputStale = !!job.output;
  job.message = 'Автоподгонка включена для всех клипов. Соберите MP4 заново; озвучка и исходники сохранены.';
}
export async function importClip(id: string, scope: VideoScope, revision: number, shotId: string, bytes: Uint8Array, root = productionRoot()) {
  if (bytes.length < 12 || bytes.length > clipMaxBytes || Buffer.from(bytes.subarray(4, 8)).toString('ascii') !== 'ftyp') throw new Error('Нужен MP4 размером до 32 МиБ.');
  return editJob(id, scope, revision, async job => {
    const shot = job.shots.find(s => s.id === shotId);
    if (!shot) throw new Error('Сцена не найдена.');
    const cwd = jobDirectory(id, root), file = `${randomUUID()}.mp4`;
    try {
      await atomicWrite(join(cwd, file), bytes);
      const probe = JSON.parse(await runProgram(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', file], cwd, 30000));
      const streams = probe.streams?.filter((s: { codec_type: string }) => s.codec_type === 'video');
      const video = streams?.[0];
      const streamDuration = Number(video?.duration);
      const duration = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : Number(probe.format?.duration);
      if (!Number.isFinite(duration) || duration < 0.1 || duration > 60 || streams?.length !== 1 || !Number.isInteger(video?.width) || !Number.isInteger(video?.height) || video.width < 16 || video.height < 16 || video.width > 4096 || video.height > 4096) throw new Error('Нужен MP4 с одной видеодорожкой, от 0,1 до 60 секунд, не больше 4096 × 4096.');
      const tail = shot.clip?.tail ?? 'auto';
      shot.clip = { file, duration, source: 'upload', tail };
      selectVisual(job, shotId, 'clip', tail);
    } catch (e) { await unlink(join(cwd, file)).catch(() => {}); throw e; }
  }, root);
}
