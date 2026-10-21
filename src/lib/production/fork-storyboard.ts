import { copyFile, mkdir, rename, rmdir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { type VideoJob, type VideoScope } from './model';
import { assertScope, assetFile, atomicWrite, jobDirectory, listJobs, productionRoot, readJob, withLock } from './store';
import { timedStoryboard } from './timed-storyboard';

export async function forkStoryboard(id: string, scope: VideoScope, revision: number, target: number, root = productionRoot()) {
  // withLock creates its parent directory; reject a missing/foreign source first.
  assertScope(await readJob(id, root), scope);
  return withLock(join(jobDirectory(id, root), 'edit.lock'), async () => {
    const source = await readJob(id, root); assertScope(source, scope);
    if (source.revision !== revision) throw new Error('Видео изменилось. Обновите расчёт.');
    const plan = timedStoryboard(source, target);
    if (plan.summary.after === plan.summary.before) throw new Error('Кадры уже достаточно короткие. Новая сборка не нужна.');
    // A lost HTTP response must not create duplicate local copies on the next click.
    const existing = (await listJobs(scope, root)).find(j => j.storyboardFrom?.id === id && j.storyboardFrom.revision === revision && j.storyboardFrom.target === target);
    if (existing) return existing;
    const now = new Date().toISOString();
    const job: VideoJob = { ...source, id: randomUUID(), createdAt: now, updatedAt: now, revision: 1,
      status: 'draft', message: 'Подробный план создан. Озвучка скопирована; проверьте описания новых кадров перед генерацией.',
      shots: plan.shots.map(s => ({ ...s, id: randomUUID() })), audio: { state: 'ready', file: source.audio.file },
      attempts: [], output: undefined, subtitles: undefined, outputStale: false, operation: undefined,
      storyboardFrom: { id, revision, target },
    };
    // Non-UUID staging directories are invisible to both the UI and the worker.
    const staging = join(root, `.draft-${job.id}`);
    await mkdir(staging);
    const written: string[] = [];
    try {
      const files = new Set([job.audio.file!, ...job.shots.flatMap(s => [s.image.file, s.clip?.file]).filter((s): s is string => !!s)]);
      for (const file of files) {
        const sourcePath = assetFile(source, file, root), dest = join(staging, file);
        written.push(dest); await copyFile(sourcePath, dest, constants.COPYFILE_EXCL);
      }
      const manifest = join(staging, 'job.json'); written.push(manifest);
      await atomicWrite(manifest, JSON.stringify(job));
      await rename(staging, jobDirectory(job.id, root));
      return job;
    } catch (error) {
      for (const file of written) await unlink(file).catch(() => {});
      await rmdir(staging).catch(() => {});
      throw error;
    }
  });
}
