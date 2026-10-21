// Explicit local FFmpeg integration check. Synthetic fixtures, no model calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createJob, jobDirectory, saveJob, readJob } from '../src/lib/production/store';
import { renderVideo, runProgram } from '../src/lib/production/render';
import { importClip, selectVisual } from '../src/lib/production/clips';

test('real FFmpeg renders mixed JPEG/PNG and fitted clips with preserved speech and subtitles', { timeout: 240000 }, async () => {
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
    await saveJob(job, root);
    await runProgram(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=0.25', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'clip.mp4'], cwd, 30000);
    const clipBytes = await readFile(join(cwd, 'clip.mp4'));
    const scope = { ownerId: job.ownerId, projectId: job.projectId, versionId: job.versionId };
    await assert.rejects(importClip(job.id, { ...scope, ownerId: randomUUID() }, job.revision, job.shots[0].id, clipBytes, root), /недоступно/);
    const mixed = await importClip(job.id, scope, job.revision, job.shots[0].id, clipBytes, root);
    assert.equal(mixed.shots[0].image.file, job.shots[0].image.file);
    assert.equal(mixed.audio.file, job.audio.file);
    assert.equal((await readJob(job.id, root)).shots[0].clip?.source, 'upload');
    assert.equal(mixed.shots[0].clip?.tail, 'auto');
    const automatic = await renderVideo(mixed, root, async () => {});
    selectVisual(mixed, mixed.shots[0].id, 'clip', 'hold');
    const held = await renderVideo(mixed, root, async () => {});
    selectVisual(mixed, mixed.shots[0].id, 'clip', 'loop');
    const looped = await renderVideo(mixed, root, async () => {});
    for (const [name, file] of [['held', held.output], ['looped', looped.output], ['automatic', automatic.output]]) {
      await runProgram(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'], cwd, 30000);
      await runProgram(ffmpeg, ['-v', 'error', '-ss', '0.45', '-i', file, '-frames:v', '1', '-f', 'md5', `${name}.md5`], cwd, 30000);
      await runProgram(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 'md5', `${name}-audio.md5`], cwd, 30000);
    }
    assert.notEqual(await readFile(join(cwd, 'held.md5'), 'utf8'), await readFile(join(cwd, 'looped.md5'), 'utf8'));
    assert.equal(await readFile(join(cwd, 'held-audio.md5'), 'utf8'), await readFile(join(cwd, 'looped-audio.md5'), 'utf8'));
    assert.equal(await readFile(join(cwd, 'held-audio.md5'), 'utf8'), await readFile(join(cwd, 'automatic-audio.md5'), 'utf8'));
    // Compare motion after the source clip has ended: auto must not freeze its final frame.
    await runProgram(ffmpeg, ['-v', 'error', '-ss', '0.35', '-i', automatic.output, '-frames:v', '1', '-f', 'md5', 'automatic-earlier.md5'], cwd, 30000);
    assert.notEqual(await readFile(join(cwd, 'automatic-earlier.md5'), 'utf8'), await readFile(join(cwd, 'automatic.md5'), 'utf8'));
    await runProgram(ffmpeg, ['-v', 'error', '-i', clean.output, '-map', '0:a:0', '-f', 'md5', 'clean-audio.md5'], cwd, 30000);
    assert.equal(await readFile(join(cwd, 'clean-audio.md5'), 'utf8'), await readFile(join(cwd, 'held-audio.md5'), 'utf8'));
    // A 0.5s source fits the 0.6s first scene by slowing down, not by looping or freezing.
    await runProgram(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=0.5',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'slow-source.mp4'], cwd, 30000);
    mixed.shots[0].clip = { file: 'slow-source.mp4', duration: 0.5, source: 'upload', tail: 'auto' };
    const slowed = await renderVideo(mixed, root, async () => {});
    for (const time of ['0.5', '0.54']) {
      await runProgram(ffmpeg, ['-v', 'error', '-ss', time, '-i', slowed.output, '-frames:v', '1', '-f', 'md5', `slow-${time}.md5`], cwd, 30000);
    }
    assert.notEqual(await readFile(join(cwd, 'slow-0.5.md5'), 'utf8'), await readFile(join(cwd, 'slow-0.54.md5'), 'utf8'));
    await runProgram(ffmpeg, ['-v', 'error', '-i', slowed.output, '-map', '0:a:0', '-f', 'md5', 'slowed-audio.md5'], cwd, 30000);
    assert.equal(await readFile(join(cwd, 'clean-audio.md5'), 'utf8'), await readFile(join(cwd, 'slowed-audio.md5'), 'utf8'));
    assert.ok(!(await readdir(cwd)).some(name => name.endsWith('.txt')));
    assert.ok(!(await readdir(cwd)).some(name => /-(normalized|cycle)\.mp4$/.test(name)));
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('real FFmpeg assembles 14 timed shots beyond the initial planner limit', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'scenepilot-many-shots-'));
  try {
    const job = await createJob({ ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() }, { title: 'Many shots', script: 'a '.repeat(14).trim(), source: 'test', voiceId: 'fixture' }, root);
    const cwd = jobDirectory(job.id, root), ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    await runProgram(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.4', '-c:a', 'libmp3lame', 'audio.mp3'], cwd, 30000);
    await runProgram(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180', '-frames:v', '1', '-update', '1', 'frame.png'], cwd, 30000);
    job.audio = { state: 'ready', file: 'audio.mp3' }; job.subtitlesEnabled = false;
    job.alignment = { characters: job.text.split(''), character_start_times_seconds: job.text.split('').map((_, i) => i * 0.05), character_end_times_seconds: job.text.split('').map((_, i) => (i + 1) * 0.05) };
    job.shots = Array.from({ length: 14 }, (_, i) => ({ id: randomUUID(), start: i * 2, end: i * 2 + 1, text: 'a', prompt: 'blue', image: { state: 'ready' as const, file: 'frame.png' } }));
    const result = await renderVideo(job, root, async () => {});
    await runProgram(ffmpeg, ['-v', 'error', '-i', result.output, '-f', 'null', '-'], cwd, 30000);
    assert.ok((await readFile(join(cwd, result.output))).length > 1000);
    assert.ok(!(await readdir(cwd)).some(n => n.endsWith('.txt')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
