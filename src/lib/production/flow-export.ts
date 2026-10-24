import { lstat, readFile } from 'node:fs/promises';
import { assetFile, assertScope, productionRoot, readJob } from './store';
import { publicJob, type VideoScope } from './model';
import { flowFrameName } from './flow-batch';
import { flowCameraMoves, flowMotionPrompt, type FlowCameraMove } from './flow-handoff';
import { type ZipEntry, zipSize } from './zip';

export async function prepareFlowExport(id: string, scope: VideoScope, revision: number, camera: string, root = productionRoot()) {
  const job = await readJob(id, root); assertScope(job, scope);
  if (!Number.isSafeInteger(revision) || job.revision !== revision || ['queued', 'running'].includes(job.status)) throw new Error('Сборка изменилась или занята. Обновите состояние перед скачиванием.');
  if (!Object.hasOwn(flowCameraMoves, camera)) throw new Error('Неизвестное движение камеры.');
  if (!job.shots.length || job.shots.length > 120) throw new Error('В пакете может быть до 120 кадров.');
  const view = publicJob(job), entries: ZipEntry[] = [];
  const frames = [];
  const textEntry = (name: string, text: string): ZipEntry => {
    const data = Buffer.from(text, 'utf8'); return { name, size: data.length, load: async () => data };
  };
  for (const [index, shot] of job.shots.entries()) {
    if (!shot.image.file) continue;
    if (!/\.(jpg|png)$/.test(shot.image.file)) throw new Error('Неизвестный формат изображения.');
    const path = assetFile(job, shot.image.file, root), info = await lstat(path);
    if (!info.isFile() || info.size <= 0 || info.size > 32 * 1024 * 1024) throw new Error('Изображение недоступно или превышает 32 МиБ.');
    const stem = flowFrameName(job.id, index), image = `${stem}.${shot.image.file.split('.').at(-1)}`;
    const prompt = flowMotionPrompt(shot.image.generatedPrompt || shot.prompt, camera as FlowCameraMove);
    const timing = view.shotTimings?.[shot.id];
    frames.push({ number: index + 1, shotId: shot.id, image, clip: `${stem}.mp4`, prompt, durationSeconds: timing ? Number((timing.end - timing.start).toFixed(3)) : null });
    entries.push({ name: image, size: info.size, load: () => readFile(path) }, textEntry(`${stem}.txt`, prompt));
  }
  if (!frames.length) throw new Error('Сначала создайте хотя бы одно изображение.');
  const manifest = { format: 'scenepilot-flow-v1', jobId: job.id, versionId: job.versionId, revision: job.revision, title: job.title, camera, frames };
  entries.push(textEntry('manifest.json', JSON.stringify(manifest, null, 2)), textEntry('prompts.txt', frames.map(frame => `КАДР ${frame.number}\nИзображение: ${frame.image}\nСохраните клип как: ${frame.clip}\n\n${frame.prompt}`).join('\n\n---\n\n')),
    textEntry('README.txt', `ScenePilot → Flow → ScenePilot\n\n1. Распакуйте ZIP. В нём ${frames.length} изображений из ${job.shots.length} кадров сборки.\n2. Добавьте изображения в свой проект Flow. Промпты движения — в prompts.txt и отдельных TXT.\n3. Выберите модель и проверьте расход кредитов перед генерацией. Этот пакет ничего не генерирует автоматически.\n4. Назовите каждый скачанный MP4 так же, как его изображение, заменив расширение на .mp4. Номера кадров не меняйте.\n5. В ScenePilot откройте эту же сборку → Анимация → Добавить несколько MP4. Проверьте соответствие перед импортом. Если имена другие, укажите кадры в списке вручную.\n6. Соберите MP4 с прежней озвучкой. Звук исходных клипов не используется.\n\nУказанная длительность — время озвучки, а не заказ длительности у Flow. Короткие клипы подгоняются при монтаже. Список содержит только готовые изображения; источники и остальная сборка не изменены.\n`));
  return { entries, size: zipSize(entries), filename: `scenepilot-flow-${job.id}.zip` };
}
