import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planScriptChapters, selectedScriptChapter, visibleVideoJobs } from '../src/lib/production/chapters';
import { createJob, jobDirectory, readJob, listJobs } from '../src/lib/production/store';
import { normalizeNarration, publicJob } from '../src/lib/production/model';
import { initialStoryboard } from '../src/lib/production/initial-storyboard';

const script = ('Анна идёт по Берлину 🌧️. Вдали проезжает поезд. “What happens next?” she asks. ').repeat(180);
const scope = () => ({ ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() });
const input = { title: 'Проверка', script, source: 'manual', voiceId: 'fixture', imageProvider: 'none' as const };

test('chapter boundaries preserve all normalized narration, punctuation and Unicode with valid production plans', () => {
  for (const pace of [80, 140, 220]) for (const source of [script, 'word '.repeat(3900), 'x '.repeat(9999), 'Начало.\n\n' + 'The city wakes. '.repeat(430)]) {
    const parts = planScriptChapters(source, pace), normalized = normalizeNarration(source);
    assert.equal(parts.map(part => part.text).join(' '), normalized);
    assert.ok(parts.length <= 20);
    for (const [index, part] of parts.entries()) {
      assert.equal(part.number, index + 1); assert.equal(normalized.slice(part.start, part.end), part.text);
      assert.ok(part.text.length <= 5000); assert.ok(part.text.length > 0);
      assert.ok(part.estimatedSeconds <= 900);
      assert.ok(!/^\p{Surrogate}|\p{Surrogate}$/u.test(part.text));
      const plan = initialStoryboard(part.text, pace); assert.equal(plan.text, part.text); assert.ok(plan.shots.length <= 120);
      if (index) assert.equal(normalized.slice(parts[index - 1].end, part.start), ' ');
    }
  }
});

test('short scripts stay whole; invalid selections, oversized scripts and indivisible words never silently truncate', () => {
  const short = '  Привет, мир!\nЭто один ролик.  ';
  assert.deepEqual(planScriptChapters(short).map(p => p.text), ['Привет, мир! Это один ролик.']);
  for (const bad of ['', ' ', 'a'.repeat(20001), 'x'.repeat(5001)]) assert.throws(() => planScriptChapters(bad));
  for (const pace of [0, 79, 221, NaN]) assert.throws(() => planScriptChapters(script, pace), /темп/);
  for (const index of [-1, 0.5, '0', NaN, Infinity, 999]) assert.throws(() => selectedScriptChapter(script, 140, index));
  assert.throws(() => selectedScriptChapter(short, 140, 0), /не существует/);
  const parts = planScriptChapters(script); const selected = selectedScriptChapter(script, undefined, 1);
  assert.equal(selected.chapter.text, parts[1].text); assert.equal(selected.total, parts.length);
});

test('selected chapter becomes an isolated draft with a full source snapshot and no generation, preserving existing jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-chapters-'));
  try {
    const s = scope(); const original = await createJob(s, { ...input, script: 'Existing short script.' }, root);
    const originalBytes = await readFile(join(jobDirectory(original.id, root), 'job.json'));
    const parts = planScriptChapters(script);
    const first = await createJob(s, { ...input, chapterIndex: 0 }, root), second = await createJob(s, { ...input, chapterIndex: 1 }, root);
    assert.notEqual(first.id, second.id); assert.equal(first.text, parts[0].text); assert.equal(second.text, parts[1].text);
    for (const [index, job] of [first, second].entries()) {
      assert.equal(job.chapter?.number, index + 1); assert.equal(job.chapter?.total, parts.length);
      assert.equal(job.script, parts[index].text); assert.equal(job.versionScript, script); assert.equal(job.status, 'draft');
      assert.deepEqual(job.attempts, []); assert.equal(job.operation, undefined); assert.equal(job.audio.file, undefined);
      assert.ok(job.shots.every(shot => shot.image.state === 'empty' && !shot.image.file));
      assert.equal(job.versionId, s.versionId); assert.equal(job.voiceId, input.voiceId);
      assert.deepEqual(publicJob(job).chapter, job.chapter); assert.equal('ownerId' in publicJob(job), false);
      assert.equal((await readJob(job.id, root)).versionScript, script);
    }
    assert.deepEqual(await readFile(join(jobDirectory(original.id, root), 'job.json')), originalBytes);
    const before = (await readdir(root)).sort();
    for (const index of [-1, 1.5, 999]) await assert.rejects(createJob(s, { ...input, chapterIndex: index }, root));
    await assert.rejects(createJob(s, { ...input, chapterIndex: 0, scenes: [] }, root), /сцены/);
    await assert.rejects(createJob({ ...s, ownerId: 'invalid' }, { ...input, chapterIndex: 0 }, root));
    assert.deepEqual((await readdir(root)).sort(), before);
    assert.equal((await listJobs({ ...s, ownerId: randomUUID() }, root)).length, 0);
  } finally { assert.ok(root.startsWith(join(tmpdir(), 'sp-chapters-'))); await rm(root, { recursive: true, force: true }); }
});

test('history retains the latest build for every chapter past the normal 20-build window', () => {
  const job = (n?: number) => ({ versionId: 'v', chapter: n ? { number: n, total: 2, start: 0, end: 1, sourceCharacters: 2 } : undefined });
  const recent = [job(1), ...Array.from({ length: 24 }, () => job())], older = job(2), duplicate = job(1);
  const visible = visibleVideoJobs([...recent, older, duplicate]);
  assert.equal(visible.length, 21); assert.equal(visible.at(-1), older); assert.ok(!visible.includes(duplicate));
});
