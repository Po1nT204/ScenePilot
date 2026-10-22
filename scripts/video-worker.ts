import { loadEnvConfig } from '@next/env';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { productionRoot, withLock, listJobs, readJob, saveJob, jobDirectory } from '../src/lib/production/store';
import { processJob, recoverJob, services } from '../src/lib/production/processor';
import { providerConfig } from '../src/lib/production/providers';
import { workerFailure, type WorkerPhase } from '../src/lib/production/worker-diagnostics';

loadEnvConfig(process.cwd());
const root = productionRoot();
let stopping = false;
let phase: WorkerPhase = 'folder';
const checkOnly = process.argv.includes('--check');
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
async function main() {
  await mkdir(root, { recursive: true });
  phase = 'lock';
  await withLock(join(root, 'worker.lock'), async () => {
    phase = 'read';
    const jobs = await listJobs(undefined, root);
    if (checkOnly) {
      console.log(`Проверка пройдена: папка доступна, блокировка получена, сборок прочитано: ${jobs.length}. Генерация и восстановление задач не запускались.`);
      return;
    }
    phase = 'heartbeat';
    const beat = () => writeFile(join(root, 'heartbeat'), String(Date.now()));
    await beat(); const timer = setInterval(() => { void beat().catch(() => {}); }, 3000);
    console.log('Обработчик видео запущен. Ожидает задачи из ScenePilot. Ctrl+C — остановить после текущей задачи.');
    try {
      phase = 'recover';
      for (const job of jobs) {
        if (recoverJob(job)) await saveJob(job, root);
      }
      while (!stopping) {
        phase = 'read';
        for (const candidate of (await listJobs(undefined, root)).reverse()) {
          if (stopping || candidate.status !== 'queued') continue;
          phase = 'process';
          await withLock(join(jobDirectory(candidate.id, root), 'edit.lock'), async () => {
            await processJob(await readJob(candidate.id, root), root, services(providerConfig()));
          });
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    } finally { clearInterval(timer); await unlink(join(root, 'heartbeat')).catch(() => {}); }
  });
}
main().catch(error => { console.error(workerFailure(error, phase)); process.exitCode = 1; });
