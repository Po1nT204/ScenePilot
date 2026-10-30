import { copyFile, stat, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertScope, assetFile, atomicWrite, jobDirectory, readJob, withLock } from './store';
import { releaseDirectory, saveRelease } from './release-store';
import { releasePartProblem, type VideoRelease } from './release-model';
import { runProgram } from './render';

type MediaInfo = { duration: number; frames: number; signature: string };
async function inspect(file: string, cwd: string): Promise<MediaInfo> {
  const probe = JSON.parse(await runProgram(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,time_base,sample_rate,channels,channel_layout,nb_frames', '-of', 'json', file], cwd, 30000));
  const streams = probe.streams as Record<string, string | number>[] | undefined;
  const video = streams?.find(stream => stream.codec_type === 'video'), audio = streams?.find(stream => stream.codec_type === 'audio');
  const frames = Number(video?.nb_frames), duration = frames / 24;
  if (streams?.length !== 2 || !video || !audio || video.codec_name !== 'h264' || video.width !== 1280 || video.height !== 720 ||
    video.pix_fmt !== 'yuv420p' || video.r_frame_rate !== '24/1' || audio.codec_name !== 'aac' ||
    !Number.isSafeInteger(frames) || frames <= 0 || !Number.isFinite(Number(probe.format?.duration)) || Math.abs(Number(probe.format?.duration) - duration) > 0.25) throw new Error('Формат MP4 не подходит для объединения. Пересоберите части в ScenePilot.');
  return { duration, frames, signature: JSON.stringify([video.profile, video.level, video.time_base, audio.sample_rate, audio.channels, audio.channel_layout]) };
}
export async function renderRelease(release: VideoRelease, root: string, progress: (message: string) => Promise<void>) {
  const cwd = releaseDirectory(release.id, root), stem = randomUUID(), output = `${stem}.mp4`, manifest = `${stem}.txt`;
  const copies: string[] = [], info: MediaInfo[] = [];
  try {
    for (const [index, input] of release.inputs.entries()) {
      await progress(`Подготовка части ${index + 1} из ${release.inputs.length}`);
      const file = `${stem}-${index}.mp4`; copies.push(file);
      await withLock(join(jobDirectory(input.jobId, root), 'edit.lock'), async () => {
        const job = await readJob(input.jobId, root); assertScope(job, release);
        if (job.output !== input.output || releasePartProblem(job)) throw new Error(`Часть ${index + 1} изменилась. Обновите список и соберите выпуск снова.`);
        const source = assetFile(job, input.output, root), size = (await stat(source)).size, space = await statfs(cwd);
        // Keep space for both the snapshot and joined result, with a reserve for the audio muxer.
        const used = (await Promise.all(copies.slice(0, -1).map(name => stat(join(cwd, name))))).reduce((sum, entry) => sum + entry.size, 0);
        if (space.bavail * space.bsize < 2 * size + used + 512 * 1024 * 1024) throw new Error('Недостаточно места для выпуска. Освободите место и повторите сборку вручную.');
        await copyFile(source, join(cwd, file));
      });
      const part = await inspect(file, cwd);
      if (part.duration > 900.25 || (info.length && part.signature !== info[0].signature)) throw new Error('Параметры частей различаются. Пересоберите их в ScenePilot перед объединением.');
      info.push(part);
    }
    const duration = info.reduce((sum, item) => sum + item.duration, 0);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error('Объединение поддерживает до 60 минут готовых частей.');
    // Explicit video durations prevent AAC encoder padding accumulating at every cut.
    await atomicWrite(join(cwd, manifest), copies.map((file, index) => `file '${file}'\nduration ${info[index].duration.toFixed(9)}`).join('\n'));
    await progress('Соединение готовых частей в один MP4');
    await runProgram(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-nostdin', '-n', '-f', 'concat', '-safe', '1', '-i', manifest,
      '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', 'aresample=async=1:first_pts=0,apad', '-c:a', 'aac', '-b:a', '128k',
      '-t', String(duration), '-movflags', '+faststart', output], cwd);
    const result = await inspect(output, cwd);
    if (result.frames !== info.reduce((sum, item) => sum + item.frames, 0) || Math.abs(result.duration - duration) > 1 / 24 || (await stat(join(cwd, output))).size < 1000) throw new Error('Выпуск не прошёл проверку длительности. Исходные части сохранены.');
    return { output, duration };
  } catch (error) { await unlink(join(cwd, output)).catch(() => {}); throw error; }
  finally { for (const file of [...copies, manifest]) await unlink(join(cwd, file)).catch(() => {}); }
}
export function recoverRelease(release: VideoRelease) {
  if (release.status !== 'running') return false;
  release.status = 'failed'; release.message = 'Сборка выпуска была прервана. Части сохранены; запустите объединение снова вручную.'; return true;
}
export async function processRelease(release: VideoRelease, root: string, render = renderRelease) {
  if (release.status !== 'queued') return;
  try {
    release.status = 'running'; release.message = 'Подготовка выпуска'; await saveRelease(release, root);
    const result = await render(release, root, async message => { release.message = message; await saveRelease(release, root); });
    release.output = result.output; release.duration = result.duration;
    release.status = 'ready'; release.message = 'Весь ролик готов. Проверьте стыки частей и скачайте MP4.';
  } catch (error) {
    release.status = 'failed';
    release.message = error instanceof Error && !('code' in error) && !(error instanceof SyntaxError) ? error.message : 'Не удалось собрать выпуск. Проверьте файлы частей и свободное место. Исходные материалы сохранены.';
  }
  await saveRelease(release, root);
}
