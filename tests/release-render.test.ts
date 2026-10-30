// Explicit local media check: generated colors/tones only, no account or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJob, jobDirectory, saveJob } from '../src/lib/production/store';
import { renderVideo, runProgram } from '../src/lib/production/render';
import { queueRelease, readRelease, releaseDirectory, releaseFile } from '../src/lib/production/release-store';
import { processRelease } from '../src/lib/production/release-render';

test('real part MP4s join in order with identical decoded frames, continuous audio and retained captions', { timeout: 180000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-release-render-'));
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg', ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const script = 'A familiar morning changes everything. '.repeat(160);
  try {
    const scope = { ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() }, jobs = [], frames: number[] = [], hashes: string[] = [];
    for (let chapterIndex = 0; chapterIndex < 2; chapterIndex++) {
      const job = await createJob(scope, { title: 'Test', script, source: 'test', voiceId: 'fixture', chapterIndex }, root), cwd = jobDirectory(job.id, root);
      const speech = chapterIndex ? 1.75 : 1.25;
      await runProgram(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${chapterIndex ? 880 : 440}:duration=${speech}`, '-c:a', 'libmp3lame', 'voice.mp3'], cwd, 30000);
      await runProgram(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${chapterIndex ? 'blue' : 'orange'}:s=1280x720`, '-frames:v', '1', '-update', '1', 'frame.png'], cwd, 30000);
      job.audio = { state: 'ready', file: 'voice.mp3' }; job.subtitlesEnabled = !!chapterIndex;
      job.alignment = { characters: job.text.split(''), character_start_times_seconds: [...job.text].map((_, index) => index * speech / job.text.length), character_end_times_seconds: [...job.text].map((_, index) => (index + 1) * speech / job.text.length) };
      job.shots = [{ id: randomUUID(), text: job.text, start: 0, end: job.text.length, prompt: 'Synthetic color', image: { state: 'ready', file: 'frame.png' } }];
      Object.assign(job, await renderVideo(job, root, async () => {})); job.status = 'ready'; await saveJob(job, root); jobs.push(job);
      const info = JSON.parse(await runProgram(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames', '-of', 'json', job.output!], cwd, 30000)); frames.push(Number(info.streams[0].nb_frames));
      await runProgram(ffmpeg, ['-v', 'error', '-i', job.output!, '-map', '0:v:0', '-f', 'framemd5', 'original.md5'], cwd, 30000);
      hashes.push(...(await readFile(join(cwd, 'original.md5'), 'utf8')).split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1)!.trim()));
    }
    const originals = await Promise.all(jobs.map(job => readFile(join(jobDirectory(job.id, root), job.output!))));
    const release = await queueRelease(scope, script, undefined, jobs.map(job => ({ id: job.id, revision: job.revision })), root);
    await processRelease(release, root);
    assert.equal(release.status, 'ready', release.message); assert.equal((await readRelease(release.id, root)).status, 'ready');
    const cwd = releaseDirectory(release.id, root);
    const expectedDuration = frames.reduce((sum, count) => sum + count, 0) / 24;
    assert.ok(Math.abs(release.duration! - expectedDuration) < 1 / 24);
    await runProgram(ffmpeg, ['-v', 'error', '-i', release.output!, '-map', '0:v:0', '-f', 'framemd5', 'joined.md5'], cwd, 30000);
    const actual = (await readFile(join(cwd, 'joined.md5'), 'utf8')).split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1)!.trim());
    assert.deepEqual(actual, hashes, 'every decoded frame, including captions, survives in order');
    await runProgram(ffmpeg, ['-v', 'error', '-i', release.output!, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 's16le', 'audio.pcm'], cwd, 30000);
    const pcm = await readFile(join(cwd, 'audio.pcm'));
    const signal = (at: number, duration: number) => {
      const from = Math.round(at * 16000), to = from + Math.round(duration * 16000); let crossings = 0, energy = 0;
      for (let i = from; i < to; i++) { const sample = pcm.readInt16LE(i * 2); energy += sample * sample; if (i > from && sample >= 0 && pcm.readInt16LE((i - 1) * 2) < 0) crossings++; }
      return { frequency: crossings / duration, rms: Math.sqrt(energy / (to - from)) };
    };
    assert.ok(Math.abs(signal(0.3, 0.4).frequency - 440) < 15);
    const cut = frames[0] / 24;
    assert.ok(Math.abs(signal(cut + 0.3, 0.4).frequency - 880) < 15);
    // Small codec padding may remain; neither a dropped track nor a long silent gap is acceptable.
    assert.ok(signal(cut - 0.1, 0.2).rms > 500);
    assert.ok(Math.abs(pcm.length / 2 / 16000 - expectedDuration) < 0.1);
    assert.ok((await readFile(releaseFile(release, root))).length > 1000);
    assert.ok(!(await readdir(cwd)).some(name => name.endsWith('.txt') || /-\d+\.mp4$/.test(name)), 'temporary copies must be removed');
    for (let i = 0; i < jobs.length; i++) assert.deepEqual(await readFile(join(jobDirectory(jobs[i].id, root), jobs[i].output!)), originals[i]);
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'sp-release-render-'))); await rm(root, { recursive: true, force: true }); }
});
