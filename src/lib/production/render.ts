import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { type VideoJob, makeSubtitles, parseAlignment, assetsReady, usesClip, shotTimings } from './model';
import { atomicWrite, jobDirectory } from './store';
import { clipFit, videoFps } from './clip-timing';

const normalizeVideo = `fps=${videoFps},scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,format=yuv420p`;
const encodeVideo = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2'];

export function runProgram(command: string, args: string[], cwd: string, timeoutMs = 30 * 60 * 1000) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Сборка превысила время ожидания. Готовые материалы сохранены.')); }, timeoutMs);
    child.stdout.on('data', b => { output = (output + b.toString()).slice(-16000); });
    child.stderr.on('data', b => { errors = (errors + b.toString()).slice(-4000); });
    child.on('error', () => { clearTimeout(timeout); reject(new Error('Не удалось запустить FFmpeg/ffprobe. Проверьте установку и пути в настройках.')); });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) {
        // Tool output can contain local paths. Keep the UI error concise and free of paths.
        void errors;
        reject(new Error('FFmpeg не смог обработать материалы. Проверьте файлы и свободное место; генерация не повторялась.'));
      } else resolve(output);
    });
  });
}
export async function renderVideo(job: VideoJob, root: string, progress: (text: string) => Promise<void>) {
  if (!assetsReady(job)) throw new Error('Не хватает материалов для сборки.');
  const cwd = jobDirectory(job.id, root);
  const space = await statfs(cwd);
  if (space.bavail * space.bsize < 512 * 1024 * 1024) throw new Error('Для сборки нужно хотя бы 512 МиБ свободного места.');
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const alignment = parseAlignment(job.alignment, job.text);
  const probe = JSON.parse(await runProgram(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', job.audio.file!], cwd, 30000));
  const duration = Number(probe.format?.duration);
  const lastWord = alignment.character_end_times_seconds.at(-1)!;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 900 || duration + 0.1 < lastWord) throw new Error('Длительность аудио не соответствует таймингам.');
  const stem = randomUUID();
  const srt = `${stem}.srt`, output = `${stem}.mp4`, concat = `${stem}.txt`;
  const parts: string[] = [];
  const temporary: string[] = [];
  const fps = videoFps;
  const timings = shotTimings(job, duration);
  await atomicWrite(join(cwd, srt), makeSubtitles(job.text, alignment));
  try {
    for (let i = 0; i < job.shots.length; i++) {
      await progress(`Сборка кадра ${i + 1} из ${job.shots.length}`);
      const { start, end } = timings[job.shots[i].id];
      const frames = Math.round(end * fps) - Math.round(start * fps);
      if (frames < 1) throw new Error('Тайминг кадра слишком короткий.');
      const part = `${stem}-${i}.mp4`; parts.push(part);
      // One image at a time: bounded memory on a laptop; all filenames are server generated.
      const shot = job.shots[i];
      const clip = usesClip(shot) ? shot.clip : undefined;
      const tempStart = temporary.length;
      let source = clip?.file || shot.image.file!;
      let repeat = clip?.tail === 'loop', stretch = 1;
      if (clip?.tail === 'auto') {
        // Normalize once, then count actual decoded video frames, ignoring an imported audio track.
        const normalized = `${stem}-${i}-normalized.mp4`; temporary.push(normalized);
        await runProgram(ffmpeg, ['-v', 'error', '-nostdin', '-n', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', source, '-map', '0:v:0', '-vf', normalizeVideo,
          ...encodeVideo, '-filter_threads', '1', normalized], cwd);
        const info = JSON.parse(await runProgram(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'json', normalized], cwd, 30000));
        const count = Number(info.streams?.[0]?.nb_frames);
        const fit = clipFit(count, frames);
        source = normalized; stretch = fit.stretch;
        repeat = fit.kind === 'smooth' || fit.kind === 'loop';
        if (fit.kind === 'smooth') {
          await progress(`Кадр ${i + 1}: сглаживание повторов короткого клипа`);
          const cycle = `${stem}-${i}-cycle.mp4`; temporary.push(cycle);
          const fade = fit.fadeFrames;
          // A cycle consists of the middle, then the tail crossfaded into the head.
          // Separate readers avoid retaining an entire decoded clip in a split/reverse filter.
          const graph = `[0:v]trim=start_frame=${fade}:end_frame=${count - fade},setpts=PTS-STARTPTS,settb=1/${fps}[middle];` +
            `[1:v]trim=start_frame=${count - fade}:end_frame=${count},setpts=PTS-STARTPTS,settb=1/${fps}[tail];` +
            `[2:v]trim=end_frame=${fade},setpts=PTS-STARTPTS,settb=1/${fps}[head];` +
            `[tail][head]xfade=transition=fade:duration=${fade / fps}:offset=0[seam];` +
            `[middle][seam]concat=n=2:v=1:a=0,format=yuv420p[out]`;
          await runProgram(ffmpeg, ['-v', 'error', '-nostdin', '-n', '-threads', '2', '-i', normalized, '-threads', '2', '-i', normalized, '-threads', '2', '-i', normalized,
            '-filter_complex_threads', '1', '-filter_complex', graph, '-map', '[out]', ...encodeVideo, cycle], cwd);
          source = cycle;
        }
      }
      const filter = clip ? `setpts=${stretch}*(PTS-STARTPTS),${normalizeVideo},tpad=stop_mode=clone:stop_duration=${frames / fps}` : `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,zoompan=z='1+0.04*on/${frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${frames}:s=1280x720:fps=${fps},format=yuv420p`;
      await runProgram(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...(clip ? ['-protocol_whitelist', 'file,pipe', '-f', 'mov', ...(repeat ? ['-stream_loop', '-1'] : [])] : []), '-i', source, '-vf', filter,
        '-frames:v', String(frames), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '2', '-filter_threads', '1', part], cwd);
      // Do not accumulate normalized source/cycle copies across a long sequence.
      for (const file of temporary.slice(tempStart)) await unlink(join(cwd, file)).catch(() => {});
    }
    await progress('Соединение кадров, озвучки и субтитров');
    await atomicWrite(join(cwd, concat), parts.map(p => `file '${p}'`).join('\n'));
    await runProgram(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-f', 'concat', '-safe', '1', '-i', concat, '-i', job.audio.file!,
      '-map', '0:v:0', '-map', '1:a:0', ...(job.subtitlesEnabled === false ? [] : ['-vf', `subtitles=${srt}:force_style='FontName=Arial,FontSize=22,Outline=2,Shadow=0,MarginV=24'`]),
      '-af', 'apad', '-t', String(duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '2', '-filter_threads', '1',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output], cwd);
    if ((await stat(join(cwd, output))).size < 1000) throw new Error('Получен пустой видеофайл.');
    const result = JSON.parse(await runProgram(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', output], cwd, 30000));
    if (Math.abs(Number(result.format?.duration) - duration) > 0.25 || !result.streams?.some((s: { codec_type: string }) => s.codec_type === 'audio') || !result.streams?.some((s: { codec_type: string }) => s.codec_type === 'video')) throw new Error('Готовое видео не прошло проверку длительности или дорожек.');
    return { output, subtitles: srt };
  } catch (error) { await unlink(join(cwd, output)).catch(() => {}); throw error; }
  finally { for (const file of [...parts, ...temporary, concat]) await unlink(join(cwd, file)).catch(() => {}); }
}
