import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJob, jobDirectory, listJobs, readJob, saveJob } from '../src/lib/production/store';
import { timedStoryboard } from '../src/lib/production/timed-storyboard';
import { forkStoryboard } from '../src/lib/production/fork-storyboard';
import { estimatedCost, type VideoJob } from '../src/lib/production/model';

function voiced(job: VideoJob, seconds = 0.15) {
  job.audio = { state: 'ready', file: `${randomUUID()}.mp3` };
  job.alignment = { characters: job.text.split(''), character_start_times_seconds: job.text.split('').map((_, i) => i * seconds), character_end_times_seconds: job.text.split('').map((_, i) => (i + 1) * seconds) };
  return job;
}
async function fixture(run: (job: VideoJob, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'scenepilot-storyboard-'));
  try {
    const job = voiced(await createJob({ ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() }, {
      title: 'Test', source: 'test', voiceId: 'fixture', script: 'Путешествие 🌄 продолжается вдоль реки и старого города. '.repeat(12), imageProvider: 'google-nano-banana-21',
    }, root));
    await writeFile(join(jobDirectory(job.id, root), job.audio.file!), 'speech unchanged');
    await saveJob(job, root); await run(job, root);
  } finally {
    // Only flat, test-owned folders; no recursive deletion of computed paths.
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const dir = join(root, entry.name);
      if (entry.isDirectory()) { for (const file of await readdir(dir)) await unlink(join(dir, file)); await rmdir(dir); }
      else await unlink(dir);
    }
    await rmdir(root);
  }
}
test('timed storyboard preserves every word, source assets and text while adding distinct empty shots', () => fixture(async job => {
  const snapshot = structuredClone(job), { shots, summary } = timedStoryboard(job, 8);
  assert.ok(shots.length > 12); assert.equal(shots.map(s => s.text).join(' '), job.text);
  for (const s of shots) assert.equal(job.text.slice(s.start, s.end), s.text);
  assert.ok(summary.longest <= 8); assert.deepEqual(job, snapshot);
  assert.throws(() => timedStoryboard(job, 0), /Выберите/);
  job.shots[0].image.state = 'unknown'; assert.throws(() => timedStoryboard(job, 8), /незавершённые/);
}));
test('fork copies speech and retained assets once, keeps source unchanged and enforces scope/revision', () => fixture(async (job, root) => {
  const image = `${randomUUID()}.png`, clip = `${randomUUID()}.mp4`;
  job.shots[0].image = { state: 'ready', file: image, provider: 'cloudflare-sdxl' };
  job.shots[0].clip = { file: clip, duration: 8, source: 'upload', tail: 'auto' }; job.shots[0].visual = 'clip';
  for (const file of [image, clip]) await writeFile(join(jobDirectory(job.id, root), file), file);
  await saveJob(job, root);
  const before = await readJob(job.id, root), scope = { ownerId: job.ownerId, projectId: job.projectId, versionId: job.versionId };
  await assert.rejects(forkStoryboard(job.id, { ...scope, ownerId: randomUUID() }, job.revision, 8, root), /недоступно/);
  await assert.rejects(forkStoryboard(job.id, scope, job.revision - 1, 8, root), /изменилось/);
  const fork = await forkStoryboard(job.id, scope, job.revision, 8, root);
  assert.notEqual(fork.id, job.id); assert.deepEqual(await readJob(job.id, root), before);
  assert.equal((await readFile(join(jobDirectory(fork.id, root), fork.audio.file!))).toString(), 'speech unchanged');
  assert.equal(fork.shots[0].clip?.file, clip); assert.equal(fork.shots[0].image.file, image);
  assert.equal(fork.shots[1].clip, undefined); assert.equal(fork.shots[1].image.file, undefined);
  assert.equal(fork.attempts.length, 0); assert.equal(estimatedCost(fork, 'speech'), 0); assert.equal(fork.output, undefined);
  assert.equal((await forkStoryboard(job.id, scope, job.revision, 8, root)).id, fork.id);
  assert.equal((await listJobs(scope, root)).length, 2);
}));
test('failed copy leaves no visible partial job or changes to the source', () => fixture(async (job, root) => {
  await assert.rejects(forkStoryboard(randomUUID(), job, job.revision, 8, root));
  assert.deepEqual(await readdir(root), [job.id]);
  await unlink(join(jobDirectory(job.id, root), job.audio.file!));
  await assert.rejects(forkStoryboard(job.id, job, job.revision, 8, root));
  assert.deepEqual(await readdir(root), [job.id]);
  assert.equal((await readJob(job.id, root)).revision, job.revision);
}));
test('long indivisible word may exceed target; zero timestamps and excessive shot count are rejected', () => fixture(async job => {
  job.text = 'длинноесловобезпробелов'; job.shots = [{ ...job.shots[0], text: job.text, start: 0, end: job.text.length }]; voiced(job, 1);
  assert.ok(timedStoryboard(job, 6).summary.longest > 6);
  job.alignment!.character_end_times_seconds.fill(0); job.alignment!.character_start_times_seconds.fill(0);
  assert.throws(() => timedStoryboard(job, 8), /нулевую/);
  job.text = 'word '.repeat(150).trim(); job.shots = [{ ...job.shots[0], text: job.text, start: 0, end: job.text.length }]; voiced(job, 1.2);
  assert.throws(() => timedStoryboard(job, 6), /120/);
}));
