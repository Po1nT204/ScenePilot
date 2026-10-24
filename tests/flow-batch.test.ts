import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flowFrameName, suggestClipShot, assignmentProblems, clipFileProblem, importClipBatch, uploadVideoClip, type ClipAssignment } from '../src/lib/production/flow-batch';
import { prepareFlowExport } from '../src/lib/production/flow-export';
import { crc32, streamZip, zipSize, zipMaxBytes, type ZipEntry } from '../src/lib/production/zip';
import { createJob, editJob, jobDirectory } from '../src/lib/production/store';
import { publicJob, type VideoView } from '../src/lib/production/model';

const jobId = '11111111-1111-4111-8111-111111111111';
const view = () => ({ id: jobId, projectId: 'project', versionId: 'version', revision: 4, shots: [
  { id: 'first', text: 'First', image: { state: 'empty' } },
  { id: 'second', text: 'Second', image: { state: 'empty' } },
] }) as VideoView;
const file = (name: string, size = 12) => new File([new Uint8Array(size)], name, { type: 'video/mp4' });
const rows = (): ClipAssignment[] => [
  { key: 'one', file: file('one.mp4'), shotId: 'first' },
  { key: 'two', file: file('two.mp4'), shotId: 'second' },
];

test('batch matching uses the complete build ID and exact frame number, never file order', () => {
  const job = view();
  assert.equal(suggestClipShot(`${flowFrameName(job.id, 1)}.mp4`, job), 'second');
  assert.equal(suggestClipShot(`${flowFrameName(job.id, 0)} (1).MP4`, job), 'first');
  for (const name of ['shot-001.mp4', 'random-flow-video.mp4', `${flowFrameName(randomUUID(), 0)}.mp4`, `${flowFrameName(job.id, 120)}.mp4`, `${flowFrameName(job.id, 0)}.mp4.exe`]) assert.equal(suggestClipShot(name, job), '');
});
test('batch validates files, missing choices and duplicate destinations before sending', () => {
  assert.ok(clipFileProblem(file('archive.zip')));
  assert.ok(clipFileProblem({ name: 'file.mp4', size: 33 * 1024 * 1024 }));
  assert.ok(clipFileProblem(file('file.mp4', 0)));
  const selection = rows();
  assert.deepEqual(assignmentProblems(selection, view()), ['', '']);
  selection[1].shotId = 'first';
  assert.ok(assignmentProblems(selection, view()).every(Boolean));
  selection[1].shotId = 'foreign';
  assert.ok(assignmentProblems(selection, view())[1]);
});
test('batch uploads sequentially using each confirmed revision and reports every saved result', async () => {
  const revisions: number[] = [], saved: string[] = [];
  const result = await importClipBatch(view(), rows(), {
    upload: async current => { revisions.push(current.revision); return { ...current, revision: current.revision + 1 }; },
    saved: row => saved.push(row.key), started: () => {}, stop: () => false,
  });
  assert.deepEqual(revisions, [4, 5]); assert.deepEqual(saved, ['one', 'two']);
  assert.equal(result.completed, 2); assert.equal(result.stopped, false);
});
test('uncertain upload stops without retrying or sending subsequent files; completed rows survive', async () => {
  const selection = [...rows(), { key: 'three', file: file('three.mp4'), shotId: 'third' }];
  const job = view(); job.shots.push({ ...job.shots[0], id: 'third' });
  const calls: string[] = [], saved: string[] = [];
  const result = await importClipBatch(job, selection, {
    upload: async (current, row) => { calls.push(row.key); if (row.key === 'two') throw new Error('Connection reset'); return { ...current, revision: 5 }; },
    saved: row => saved.push(row.key), started: () => {}, stop: () => false,
  });
  assert.deepEqual(calls, ['one', 'two']); assert.deepEqual(saved, ['one']);
  assert.equal(result.failedKey, 'two'); assert.equal(result.completed, 1);
});
test('stop request finishes the current write and does not start the next file', async () => {
  let stop = false, calls = 0;
  const result = await importClipBatch(view(), rows(), {
    upload: async current => { calls++; stop = true; return { ...current, revision: 5 }; },
    saved: () => {}, started: () => {}, stop: () => stop,
  });
  assert.equal(calls, 1); assert.equal(result.completed, 1); assert.equal(result.stopped, true);
});
test('clip transport keeps scope and revision, rejects login HTML and incomplete receipts without retry', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++;
    const parsed = new URL(url, 'http://localhost');
    assert.equal(parsed.searchParams.get('revision'), '4'); assert.equal(parsed.searchParams.get('shot'), 'first');
    assert.equal(parsed.searchParams.get('version'), 'version'); assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST'); assert.ok(options.body instanceof File);
    return new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } });
  });
  await assert.rejects(uploadVideoClip('project', 'version', view(), 'first', file('file.mp4')), /подтвердил/);
  assert.equal(calls, 1);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ job: { ...view(), revision: 5 } }));
  await assert.rejects(uploadVideoClip('project', 'version', view(), 'first', file('file.mp4')), /неполное/);
  const saved = view(); saved.revision = 5; saved.shots[0].clip = { file: 'saved.mp4', duration: 1, tail: 'auto', source: 'upload' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ job: saved }));
  assert.equal((await uploadVideoClip('project', 'version', view(), 'first', file('file.mp4'))).revision, 5);
});

async function bytes(entries: ZipEntry[]) {
  const chunks = []; for await (const chunk of streamZip(entries)) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function unpackStoredZIP(data: Buffer) {
  const files = new Map<string, Buffer>(); let offset = 0;
  while (data.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(data.readUInt16LE(offset + 8), 0);
    const size = data.readUInt32LE(offset + 18), nameSize = data.readUInt16LE(offset + 26);
    const name = data.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const body = data.subarray(offset + 30 + nameSize, offset + 30 + nameSize + size);
    assert.equal(crc32(body), data.readUInt32LE(offset + 14)); files.set(name, body);
    offset += 30 + nameSize + size;
  }
  assert.equal(data.readUInt32LE(offset), 0x02014b50);
  const end = data.length - 22;
  assert.equal(data.readUInt32LE(end), 0x06054b50); assert.equal(data.readUInt32LE(end + 16), offset);
  assert.equal(data.readUInt16LE(end + 10), files.size);
  return files;
}
test('ZIP has standard CRC, correct directory offsets, UTF-8 data and exact Content-Length', async () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const data = Buffer.from('Промпт с кириллицей\nSecond line');
  const entries = [{ name: 'prompts.txt', size: data.length, load: async () => data }];
  const zip = await bytes(entries);
  assert.equal(zip.length, zipSize(entries)); assert.deepEqual(unpackStoredZIP(zip).get('prompts.txt'), data);
  for (const name of ['../outside.txt', '/absolute.txt', 'C:\\secret.txt']) assert.throws(() => zipSize([{ ...entries[0], name }]));
  assert.throws(() => zipSize([...entries, ...entries]));
  assert.throws(() => zipSize([{ ...entries[0], size: zipMaxBytes }]));
  await assert.rejects(bytes([{ ...entries[0], size: 1 }]), /изменился/);
});

test('Flow export preserves build and audio, uses original frame numbers, excludes secrets and rejects foreign/stale/busy jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-flow-'));
  const scope = { ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() };
  try {
    let job = await createJob(scope, { title: 'Тестовый ролик', script: 'A small boat moves across the quiet lake while sunlight reaches the shore. Birds fly above the nearby forest as the camera follows the water.', source: 'manual', voiceId: 'voice12345' }, root);
    const image = `${randomUUID()}.png`, audio = `${randomUUID()}.mp3`;
    const imageBytes = Buffer.from('image fixture'), audioBytes = Buffer.from('audio fixture');
    await writeFile(join(jobDirectory(job.id, root), image), imageBytes); await writeFile(join(jobDirectory(job.id, root), audio), audioBytes);
    job = await editJob(job.id, scope, job.revision, draft => {
      draft.shots = [draft.shots[0], { ...draft.shots[0], id: randomUUID(), image: { state: 'ready', file: image, generatedPrompt: 'Original image description', pollingUrl: 'SECRET_POLLING_URL' } }];
      draft.audio = { state: 'ready', file: audio }; draft.voiceId = 'SECRET_VOICE_ID';
    }, root);
    const before = await readFile(join(jobDirectory(job.id, root), 'job.json'));
    const bundle = await prepareFlowExport(job.id, scope, job.revision, 'pan', root);
    const zip = await bytes(bundle.entries), files = unpackStoredZIP(zip);
    assert.equal(zip.length, bundle.size);
    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    assert.equal(manifest.frames.length, 1); assert.equal(manifest.frames[0].number, 2);
    assert.equal(manifest.frames[0].clip, `${flowFrameName(job.id, 1)}.mp4`);
    assert.equal(manifest.frames[0].shotId, job.shots[1].id);
    assert.match(manifest.frames[0].prompt, /Original image description/); assert.match(manifest.frames[0].prompt, /camera pan/);
    assert.deepEqual(files.get(manifest.frames[0].image), imageBytes);
    assert.ok(!zip.includes(Buffer.from('SECRET_'))); assert.ok(!zip.includes(Buffer.from(scope.ownerId)));
    assert.deepEqual(await readFile(join(jobDirectory(job.id, root), 'job.json')), before);
    assert.deepEqual(await readFile(join(jobDirectory(job.id, root), audio)), audioBytes);
    for (const key of ['ownerId', 'projectId', 'versionId'] as const) await assert.rejects(prepareFlowExport(job.id, { ...scope, [key]: randomUUID() }, job.revision, 'still', root));
    await assert.rejects(prepareFlowExport(job.id, scope, job.revision - 1, 'still', root), /изменилась/);
    await assert.rejects(prepareFlowExport(job.id, scope, job.revision, '__proto__', root), /камеры/);
    job = await editJob(job.id, scope, job.revision, draft => { draft.status = 'queued'; }, root);
    await assert.rejects(prepareFlowExport(job.id, scope, job.revision, 'still', root), /занята/);
    assert.equal('ownerId' in publicJob(job), false);
  } finally {
    assert.ok(root.startsWith(join(tmpdir(), 'sp-flow-')));
    await rm(root, { recursive: true, force: true });
  }
});
