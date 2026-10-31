import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJob, jobDirectory, readJob, saveJob } from '../src/lib/production/store';
import { productionSettings } from '../src/lib/production/settings';
import { publicJob } from '../src/lib/production/model';
import { VideoSettingsTransfer } from '../src/components/video-settings-transfer';

const scope = () => ({ ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() });
const input = { title: 'Source', script: 'A quiet city. A new story.', voiceId: 'sourceVoice', source: 'manual' };
async function temporary(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'sp-settings-'));
  try { await run(root); } finally { assert.ok(root.startsWith(join(tmpdir(), 'sp-settings-'))); await rm(root, { recursive: true, force: true }); }
}
test('new part inherits only saved settings, keeps its own text and starts without assets, costs or queued work', async () => temporary(async root => {
  const owner = scope(), script = 'A quiet city. A new story. '.repeat(300);
  const source = await createJob(owner, { ...input, script, chapterIndex: 0 }, root);
  Object.assign(source, { imageProvider: 'cloudflare-flux2-klein9b', visualStyle: 'photo', visualGuide: 'Анна: зелёное пальто. Пасмурный Берлин.', subtitlesEnabled: false,
    audio: { state: 'ready', file: `${randomUUID()}.mp3` }, alignment: { characters: ['x'], character_start_times_seconds: [0], character_end_times_seconds: [1] },
    output: `${randomUUID()}.mp4`, subtitles: `${randomUUID()}.srt`, outputStale: true, status: 'failed', operation: { kind: 'generate', budgetUSD: 10, reservedUSD: 5 },
    attempts: [{ id: randomUUID(), kind: 'speech', estimatedUSD: 1, at: new Date().toISOString() }] });
  source.shots[0].image = { state: 'ready', file: `${randomUUID()}.png`, generatedPrompt: 'old prompt', source: 'upload' };
  source.shots[0].clip = { file: `${randomUUID()}.mp4`, duration: 2, source: 'upload', tail: 'auto' }; source.shots[0].visual = 'clip';
  await saveJob(source, root);
  const before = await readFile(join(jobDirectory(source.id, root), 'job.json'));
  const job = await createJob(owner, { ...input, title: 'New part', script, chapterIndex: 1, voiceId: 'clientChoice', imageProvider: 'bfl-flux11', settingsFrom: { id: source.id, revision: source.revision } }, root);
  assert.deepEqual(productionSettings(job), productionSettings(source));
  assert.deepEqual(job.settingsFrom, { id: source.id, revision: source.revision });
  assert.equal(job.chapter?.number, 2); assert.equal(job.versionScript, script); assert.notEqual(job.text, source.text);
  assert.equal(job.status, 'draft'); assert.deepEqual(job.audio, { state: 'empty' }); assert.deepEqual(job.attempts, []); assert.equal(job.outputStale, false);
  for (const key of ['output', 'subtitles', 'alignment', 'operation', 'storyboardFrom'] as const) assert.equal(job[key], undefined);
  assert.ok(job.shots.every(shot => !shot.clip && !shot.visual && shot.image.state === 'empty' && !shot.image.file && !source.shots.some(old => old.id === shot.id)));
  assert.deepEqual(await readdir(jobDirectory(job.id, root)), ['job.json']);
  assert.deepEqual(await readFile(join(jobDirectory(source.id, root), 'job.json')), before);
  source.visualGuide = 'Later edit'; await saveJob(source, root);
  assert.equal((await readJob(job.id, root)).visualGuide, job.visualGuide);
}));
test('transfer validates owner/project/version, revision, state and missing source before creating a new job', async () => temporary(async root => {
  const owner = scope(), source = await createJob(owner, input, root), reference = { id: source.id, revision: source.revision };
  const before = await readdir(root);
  for (const key of ['ownerId', 'projectId', 'versionId']) await assert.rejects(createJob({ ...owner, [key]: randomUUID() }, { ...input, settingsFrom: reference }, root), /недоступно/);
  for (const settingsFrom of [{ id: '../escape', revision: 1 }, { id: source.id, revision: 0 }, { id: source.id, revision: 1.5 }, { id: randomUUID(), revision: 1 }]) await assert.rejects(createJob(owner, { ...input, settingsFrom }, root));
  await assert.rejects(createJob(owner, { ...input, settingsFrom: { ...reference, revision: source.revision + 1 } }, root), /изменилась/);
  for (const status of ['queued', 'running'] as const) {
    source.status = status; await saveJob(source, root);
    await assert.rejects(createJob(owner, { ...input, settingsFrom: { ...reference, revision: source.revision } }, root), /Дождитесь/);
  }
  assert.deepEqual(await readdir(root), before);
}));
test('transfer validates combined new prompts before creating a job; narration and visual briefs still come from new scenes', async () => temporary(async root => {
  const owner = scope(), source = await createJob(owner, input, root);
  source.visualStyle = 'photo'; source.visualGuide = 'Same hero'; await saveJob(source, root);
  const settingsFrom = { id: source.id, revision: source.revision }, before = await readdir(root);
  const scene = { id: randomUUID(), description: 'New event', narration: 'A new event.', visual_prompt: 'x'.repeat(1990), source: 'manual' as const };
  await assert.rejects(createJob(owner, { ...input, settingsFrom, scenes: [scene] }, root), /Кадр 1.*2000/);
  assert.deepEqual(await readdir(root), before);
  const job = await createJob(owner, { ...input, settingsFrom, scenes: [{ ...scene, visual_prompt: 'New location with the same hero.' }] }, root);
  assert.equal(job.text, scene.narration); assert.equal(job.planSource, 'scenes'); assert.equal(job.shots.length, 1);
  assert.equal(job.shots[0].prompt, 'New location with the same hero.'); assert.equal(job.shots[0].sourceSceneId, scene.id);
  assert.equal(job.visualGuide, 'Same hero'); assert.equal(job.sceneSnapshot?.[0].description, scene.description);
}));
test('old builds use their actual defaults while opting out retains independent creation', async () => temporary(async root => {
  const owner = scope(), source = await createJob(owner, input, root);
  delete source.imageProvider; delete source.visualStyle; delete source.visualGuide; delete source.subtitlesEnabled;
  await saveJob(source, root);
  const inherited = await createJob(owner, { ...input, settingsFrom: { id: source.id, revision: source.revision } }, root);
  assert.deepEqual(productionSettings(inherited), { voiceId: 'sourceVoice', imageProvider: 'bfl-flux11', visualStyle: 'original', visualGuide: '', subtitlesEnabled: true });
  const plain = await createJob(owner, { ...input, voiceId: 'otherVoice', imageProvider: 'none' }, root);
  assert.equal(plain.settingsFrom, undefined); assert.equal(plain.voiceId, 'otherVoice'); assert.equal(plain.imageProvider, 'none'); assert.equal(plain.visualGuide, undefined);
  source.visualGuide = 'x'.repeat(801); await saveJob(source, root);
  const before = await readdir(root);
  await assert.rejects(createJob(owner, { ...input, settingsFrom: { id: source.id, revision: source.revision } }, root), /800/);
  assert.deepEqual(await readdir(root), before);
}));
test('transfer preview identifies settings and warns about unsaved edits without exposing prompts when disabled', async () => temporary(async root => {
  const source = await createJob(scope(), input, root); source.visualGuide = 'Анна в зелёном пальто'; source.subtitlesEnabled = false;
  const props = { job: publicJob(source), checked: true, disabled: false, dirty: false, onChange: () => {} };
  let html = renderToStaticMarkup(<VideoSettingsTransfer {...props} />);
  for (const value of ['Использовать настройки текущей сборки', 'sourceVoice', 'Ручной перенос', 'Выключены', source.visualGuide]) assert.ok(html.includes(value));
  html = renderToStaticMarkup(<VideoSettingsTransfer {...props} dirty={true} />);
  assert.match(html, /Сначала сохраните/);
  html = renderToStaticMarkup(<VideoSettingsTransfer {...props} checked={false} />);
  assert.doesNotMatch(html, /sourceVoice|Анна|checked=""/);
}));
