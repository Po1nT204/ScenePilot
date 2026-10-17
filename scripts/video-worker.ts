import { loadEnvConfig } from '@next/env';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { productionRoot, withLock, listJobs, readJob, saveJob, jobDirectory } from '../src/lib/production/store';
import { processJob, recoverJob, services } from '../src/lib/production/processor';
import { providerConfig } from '../src/lib/production/providers';

loadEnvConfig(process.cwd());
const root = productionRoot();
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
async function main() {
  await mkdir(root, { recursive: true });
  await withLock(join(root, 'worker.lock'), async () => {
    const beat = () => writeFile(join(root, 'heartbeat'), String(Date.now())).catch(() => {});
    await beat(); const timer = setInterval(() => { void beat(); }, 3000);
    console.log('Обработчик видео запущен. Ожидает задачи из ScenePilot. Ctrl+C — остановить после текущей задачи.');
    try {
      for (const job of await listJobs(undefined, root)) {
        if (recoverJob(job)) await saveJob(job, root);
      }
      while (!stopping) {
        for (const candidate of (await listJobs(undefined, root)).reverse()) {
          if (stopping || candidate.status !== 'queued') continue;
          await withLock(join(jobDirectory(candidate.id, root), 'edit.lock'), async () => {
            await processJob(await readJob(candidate.id, root), root, services(providerConfig()));
          });
        }
        await new Promise(r => setTimeout(r, 1500));
      }
    } finally { clearInterval(timer); }
  });
}
main().catch(() => { console.error('Обработчик видео остановлен: проверьте доступ к папке материалов и отсутствие второго обработчика. Ключи и ответы API не выводятся.'); process.exitCode = 1; });
