import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJob, jobDirectory, saveJob, readJob, assertScope } from '../src/lib/production/store';
import { planScriptChapters } from '../src/lib/production/chapters';
import { listReleases, queueRelease, readRelease, releaseFile, saveRelease } from '../src/lib/production/release-store';
import { publicRelease, releaseParts } from '../src/lib/production/release-model';
import { processRelease, recoverRelease } from '../src/lib/production/release-render';
import { VideoReleasePanel } from '../src/components/video-release';

const script = 'A familiar morning changes everything. '.repeat(160);
async function fixture(root: string) {
  const scope = { ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() }, jobs = [];
  for (let chapterIndex = 0; chapterIndex < planScriptChapters(script).length; chapterIndex++) {
    const job = await createJob(scope, { title: 'Test', script, source: 'test', voiceId: 'fixture', chapterIndex }, root);
    job.output = `${randomUUID()}.mp4`; job.status = 'ready';
    await writeFile(join(jobDirectory(job.id, root), job.output), 'synthetic bytes; not a real video'); await saveJob(job, root); jobs.push(job);
  }
  return { scope, jobs, selection: jobs.map(job => ({ id: job.id, revision: job.revision })) };
}
async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'sp-releases-'));
  try { await run(root); } finally { assert.ok(root.startsWith(join(tmpdir(), 'sp-releases-'))); await rm(root, { recursive: true, force: true }); }
}
test('release queue rejects missing, duplicated, reordered, foreign, stale and changed parts without writes to sources', async () => temporary(async root => {
  const { scope, jobs, selection } = await fixture(root);
  const before = await Promise.all(jobs.map(job => readFile(join(jobDirectory(job.id, root), 'job.json'))));
  for (const selected of [selection.slice(1), [selection[0], selection[0]], [...selection].reverse(), [{ ...selection[0], revision: 0 }, selection[1]], [{ id: '../escape', revision: 1 }, selection[1]]]) {
    await assert.rejects(queueRelease(scope, script, undefined, selected, root));
  }
  for (const key of ['ownerId', 'projectId', 'versionId']) await assert.rejects(queueRelease({ ...scope, [key]: randomUUID() }, script, undefined, selection, root), /недоступно/);
  await assert.rejects(queueRelease(scope, script.replace('familiar', 'different'), undefined, selection, root), /планом/);
  assert.equal((await listReleases(scope, root)).length, 0);
  for (let index = 0; index < jobs.length; index++) assert.deepEqual(await readFile(join(jobDirectory(jobs[index].id, root), 'job.json')), before[index]);
  for (const patch of [{ outputStale: true }, { status: 'running' as const }, { output: undefined }]) {
    const original = structuredClone(jobs[0]); Object.assign(jobs[0], patch); await saveJob(jobs[0], root);
    selection[0].revision = jobs[0].revision; await assert.rejects(queueRelease(scope, script, undefined, selection, root));
    Object.assign(jobs[0], original); await saveJob(jobs[0], root);
  }
  assert.equal((await listReleases(scope, root)).length, 0);
}));
test('release snapshots and repeated clicks preserve source jobs; scope and result file access stay restricted', async () => temporary(async root => {
  const { scope, jobs, selection } = await fixture(root);
  const before = await Promise.all(jobs.map(job => readFile(join(jobDirectory(job.id, root), 'job.json'))));
  const release = await queueRelease(scope, script, undefined, selection, root);
  assert.equal(release.status, 'queued'); assert.equal(release.inputs.length, 2); assert.equal(release.output, undefined);
  assert.equal((await queueRelease(scope, script, undefined, selection, root)).id, release.id);
  assert.equal((await listReleases({ ...scope, ownerId: randomUUID() }, root)).length, 0);
  assert.throws(() => assertScope(release, { ...scope, versionId: randomUUID() }), /недоступно/);
  assert.throws(() => releaseFile(release, root), /не готов/);
  assert.equal('ownerId' in publicRelease(release, jobs), false); assert.equal(publicRelease(release, jobs).stale, false);
  let calls = 0;
  await processRelease(release, root, async (_release, _root, progress) => {
    calls++; assert.equal((await readRelease(release.id, root)).status, 'running');
    await progress('Local render'); return { output: `${randomUUID()}.mp4`, duration: 3 };
  });
  await processRelease(release, root, async () => { throw new Error('must not run twice'); });
  assert.equal(calls, 1); assert.equal(release.status, 'ready'); assert.ok(releaseFile(release, root).endsWith(release.output!));
  assert.equal((await queueRelease(scope, script, undefined, selection, root)).id, release.id);
  for (let index = 0; index < jobs.length; index++) assert.deepEqual(await readFile(join(jobDirectory(jobs[index].id, root), 'job.json')), before[index]);
  jobs[0].outputStale = true; assert.equal(publicRelease(release, jobs).stale, true);
  jobs[0].outputStale = false; jobs[0].output = `${randomUUID()}.mp4`; assert.equal(publicRelease(release, jobs).stale, true);
  assert.equal(publicRelease(release, []).stale, true);
  assert.throws(() => releaseFile({ ...release, output: '../escape.mp4' }, root));
}));
test('interrupted and failed releases need manual retry; errors hide paths and a changed source cannot be rendered', async () => temporary(async root => {
  const { scope, jobs, selection } = await fixture(root);
  const release = await queueRelease(scope, script, undefined, selection, root);
  release.status = 'running'; assert.equal(recoverRelease(release), true); assert.equal(release.status, 'failed');
  assert.equal(recoverRelease(release), false); await saveRelease(release, root);
  const retry = await queueRelease(scope, script, undefined, selection, root); assert.notEqual(retry.id, release.id);
  jobs[0].outputStale = true; await saveJob(jobs[0], root);
  await processRelease(retry, root); assert.equal(retry.status, 'failed'); assert.match(retry.message, /изменилась/); assert.equal(retry.output, undefined);
  let calls = 0; await processRelease(retry, root, async () => { calls++; throw new Error('not reached'); }); assert.equal(calls, 0);
  const queued = { ...retry, status: 'queued' as const };
  await processRelease(queued, root, async () => { throw Object.assign(new Error('SECRET C:/private'), { code: 'ENOENT' }); });
  assert.doesNotMatch(queued.message, /SECRET|private/);
  for (const job of jobs) assert.deepEqual((await readJob(job.id, root)).attempts, []);
}));
test('release UI exposes missing and stale parts, preserves completed output after failure, and stays hidden for short scripts', async () => temporary(async root => {
  const { scope, jobs, selection } = await fixture(root);
  const release = await queueRelease(scope, script, undefined, selection, root);
  release.status = 'ready'; release.output = `${randomUUID()}.mp4`; release.duration = 12;
  const props = { projectId: scope.projectId, versionId: scope.versionId, releases: [publicRelease(release, jobs)], disabled: false, workerOnline: true, onAssemble: () => {}, onRefresh: () => {} };
  let parts = releaseParts(jobs, script);
  let html = renderToStaticMarkup(<VideoReleasePanel {...props} parts={parts} />);
  assert.match(html, /Собрать весь ролик/); assert.match(html, /Скачать весь ролик/); assert.match(html, /2 из 2 готовы/);
  assert.doesNotMatch(html, /disabled=""/);
  jobs[0].outputStale = true; jobs[1].voiceId = 'different'; jobs[1].subtitlesEnabled = false;
  parts = releaseParts(jobs, script);
  html = renderToStaticMarkup(<VideoReleasePanel {...props} parts={parts} releases={[{ ...publicRelease(release, jobs), id: randomUUID(), status: 'failed', output: undefined, message: 'Failed' }, publicRelease(release, jobs)]} />);
  assert.match(html, /disabled=""/); assert.match(html, /Пересоберите/); assert.match(html, /разные голоса/); assert.match(html, /Субтитры включены/); assert.match(html, /Скачать весь ролик/); assert.match(html, /части изменились/);
  assert.match(renderToStaticMarkup(<VideoReleasePanel {...props} parts={releaseParts([], script)} />), /Подготовьте эту часть/);
  assert.equal(renderToStaticMarkup(<VideoReleasePanel {...props} parts={releaseParts(jobs, 'Short script.')} />), '');
}));
