import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite, assertScope, assetFile, jobDirectory, productionRoot, readJob, validJobId, withLock } from './store';
import { planScriptChapters } from './chapters';
import { matchesChapter, releasePartProblem, type VideoRelease } from './release-model';
import type { VideoScope } from './model';

export function releaseDirectory(id: string, root = productionRoot()) {
  if (!validJobId(id)) throw new Error('Некорректный идентификатор выпуска.');
  return join(root, 'releases', id);
}
export async function saveRelease(release: VideoRelease, root = productionRoot()) {
  release.updatedAt = new Date().toISOString();
  await atomicWrite(join(releaseDirectory(release.id, root), 'release.json'), JSON.stringify(release));
}
export async function readRelease(id: string, root = productionRoot()): Promise<VideoRelease> {
  const file = join(releaseDirectory(id, root), 'release.json');
  if ((await stat(file)).size > 128 * 1024) throw new Error('Файл выпуска слишком велик.');
  const value = JSON.parse(await readFile(file, 'utf8')) as VideoRelease;
  if (value.schema !== 1 || value.id !== id || ![value.ownerId, value.projectId, value.versionId].every(validJobId) ||
    !Array.isArray(value.inputs) || value.inputs.length < 2 || value.inputs.length > 20 ||
    !value.inputs.every((input, index) => validJobId(input.jobId) && input.number === index + 1 && /^[0-9a-f-]+\.mp4$/.test(input.output))) throw new Error('Файл выпуска повреждён.');
  return value;
}
export async function listReleases(scope?: VideoScope, root = productionRoot()) {
  const entries = await readdir(join(root, 'releases'), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  const releases: VideoRelease[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !validJobId(entry.name)) continue;
    const release = await readRelease(entry.name, root);
    if (!scope || (release.ownerId === scope.ownerId && release.projectId === scope.projectId && release.versionId === scope.versionId)) releases.push(release);
  }
  return releases.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function releaseFile(release: VideoRelease, root = productionRoot()) {
  if (release.status !== 'ready' || !release.output || !/^[0-9a-f-]+\.mp4$/.test(release.output)) throw new Error('Выпуск ещё не готов.');
  return join(releaseDirectory(release.id, root), release.output);
}
export async function queueRelease(scope: VideoScope, script: string, pace: number | undefined, selection: { id: string; revision: number }[], root = productionRoot()) {
  const plan = planScriptChapters(script, pace);
  if (![scope.ownerId, scope.projectId, scope.versionId].every(validJobId) || plan.length < 2 || plan.length > 20 || !Array.isArray(selection) || selection.length !== plan.length ||
    !selection.every(item => item && validJobId(item.id) && Number.isSafeInteger(item.revision)) || new Set(selection.map(item => item.id)).size !== selection.length) throw new Error('Выберите по одной сборке для каждой части сценария.');
  return withLock(join(root, 'releases', `${scope.versionId}.lock`), async () => {
    // Lock all parts in a fixed order; no job can change between validation and queueing.
    const ids = selection.map(item => item.id).sort();
    async function locked(index: number): Promise<VideoRelease> {
      if (index < ids.length) return withLock(join(jobDirectory(ids[index], root), 'edit.lock'), () => locked(index + 1));
      const inputs: VideoRelease['inputs'] = [];
      for (const [index, item] of selection.entries()) {
        const job = await readJob(item.id, root); assertScope(job, scope);
        if (job.revision !== item.revision) throw new Error('Часть изменилась. Обновите состояние перед сборкой выпуска.');
        if (!matchesChapter(job, plan[index], plan.length, script)) throw new Error('Части не совпадают с планом этой версии сценария.');
        const problem = releasePartProblem(job); if (problem) throw new Error(`Часть ${index + 1}: ${problem}.`);
        if (!(await stat(assetFile(job, job.output!, root))).isFile()) throw new Error('Не найден MP4 части. Пересоберите её.');
        inputs.push({ jobId: job.id, revision: job.revision, output: job.output!, number: index + 1 });
      }
      const previous = await listReleases(scope, root);
      const same = previous.find(release => release.status !== 'failed' && release.inputs.length === inputs.length && release.inputs.every((input, i) => input.jobId === inputs[i].jobId && input.output === inputs[i].output));
      if (same) return same; // Repeated clicks and lost responses cannot duplicate the same work.
      if (previous.some(release => release.status === 'queued' || release.status === 'running')) throw new Error('Дождитесь завершения сборки этого выпуска.');
      const now = new Date().toISOString();
      const release: VideoRelease = { schema: 1, id: randomUUID(), ...scope, inputs, status: 'queued', message: 'Выпуск в очереди локального обработчика.', createdAt: now, updatedAt: now };
      await mkdir(releaseDirectory(release.id, root), { recursive: true }); await saveRelease(release, root); return release;
    }
    return locked(0);
  });
}
