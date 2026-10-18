// Explicit local FFmpeg integration check. Synthetic fixtures, no model calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createJob, jobDirectory } from '../src/lib/production/store';
import { renderVideo, runProgram } from '../src/lib/production/render';

test('real FFmpeg renders mixed JPEG/PNG, probes and decodes an MP4 with subtitles and audio', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'scenepilot-render-'));
  try {
    const job = await createJob({ ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() }, { title: 'Fixture', script: 'Тест. Кадр.', source: 'test', voiceId: 'fixture' }, root);
    const cwd = jobDirectory(job.id, root);
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    await runProgram(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', '-c:a', 'libmp3lame', 'audio.mp3'], cwd, 30000);
    for (const [i, shot] of job.shots.entries()) {
      const file = `fixture-${i}.${i ? 'png' : 'jpg'}`;
      await runProgram(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${i ? 'orange' : 'green'}:s=640x360`, '-frames:v', '1', '-update', '1', file], cwd, 30000);
      shot.image = { file, state: 'ready' };
    }
    job.audio = { state: 'ready', file: 'audio.mp3' };
    job.alignment = { characters: job.text.split(''), character_start_times_seconds: job.text.split('').map((_, i) => i / 10), character_end_times_seconds: job.text.split('').map((_, i) => (i + 1) / 10) };
    const result = await renderVideo(job, root, async () => {});
    assert.ok((await readFile(join(cwd, result.output))).length > 1000);
    assert.match(await readFile(join(cwd, result.subtitles), 'utf8'), /Тест\. Кадр\./);
    await runProgram(ffmpeg, ['-v', 'error', '-i', result.output, '-f', 'null', '-'], cwd, 30000);
    job.subtitlesEnabled = false;
    const clean = await renderVideo(job, root, async () => {});
    await runProgram(ffmpeg, ['-v', 'error', '-i', clean.output, '-f', 'null', '-'], cwd, 30000);
    // Actual decoded frames must differ in the caption area; both outputs remain valid.
    for (const [name, file] of [['captions', result.output], ['clean', clean.output]]) {
      await runProgram(ffmpeg, ['-v', 'error', '-ss', '0.3', '-i', file, '-frames:v', '1', '-vf', 'crop=1280:220:0:500', '-f', 'md5', `${name}.md5`], cwd, 30000);
    }
    assert.notEqual(await readFile(join(cwd, 'captions.md5'), 'utf8'), await readFile(join(cwd, 'clean.md5'), 'utf8'));
    assert.ok(!(await readdir(cwd)).some(name => name.endsWith('.txt')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
