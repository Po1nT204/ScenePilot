'use server';
import { videoContext } from '@/lib/production/context';
import { createJob, editJob, listJobs, workerOnline, queueOperation, selectImageProvider } from '@/lib/production/store';
import { publicJob, createsMaterials, requiredProviders, neededImageProviders, productionLimits, type VideoOperation } from '@/lib/production/model';
import { providerConfig } from '@/lib/production/providers';
import { checkSpeechConnection } from '@/lib/production/connection';
import { imageAdapter, imageAvailability } from '@/lib/production/image-registry';
import { isImageProvider, validImageSelection, imageCatalog, type ImageSelection } from '@/lib/production/image-catalog';

function message(error: unknown) {
  if (error instanceof Error && !('code' in error) && !(error instanceof SyntaxError)) return error.message;
  return 'Не удалось прочитать или сохранить материалы. Проверьте доступ к локальной папке ScenePilot.';
}
export async function videoState(projectId: string, versionId: string) {
  const { scope } = await videoContext(projectId, versionId);
  try {
    const config = providerConfig();
    const imageProviders = imageAvailability(config);
    return { jobs: (await listJobs(scope)).slice(0, 20).map(publicJob), setup: { enabled: config.enabled, speech: !!config.elevenKey, images: Object.values(imageProviders).some(Boolean), imageProviders, workerOnline: await workerOnline() } };
  } catch (e) { return { error: message(e) }; }
}
export async function checkVideoSpeechConnection(projectId: string, versionId: string, voiceId: string) {
  await videoContext(projectId, versionId);
  try {
    return { connection: await checkSpeechConnection(typeof voiceId === 'string' ? voiceId.trim() : '', providerConfig().elevenKey) };
  } catch (e) { return { error: message(e) }; }
}
export async function checkVideoImageConnection(projectId: string, versionId: string, provider: string) {
  await videoContext(projectId, versionId);
  try {
    if (!isImageProvider(provider)) throw new Error('Выберите модуль изображений для проверки.');
    return { connection: await imageAdapter(provider, providerConfig()).checkConnection() };
  } catch (e) { return { error: message(e) }; }
}
export async function newVideo(projectId: string, versionId: string, voiceId: string, imageProvider: ImageSelection = 'none') {
  const { scope, project, version } = await videoContext(projectId, versionId);
  try {
    if (!validImageSelection(imageProvider)) throw new Error('Неизвестный модуль изображений.');
    const job = await createJob(scope, { title: project.title, script: version.content, source: version.source || 'unknown', voiceId: typeof voiceId === 'string' ? voiceId.trim() : '', imageProvider });
    return { job: publicJob(job) };
  } catch (e) { return { error: message(e) }; }
}
export async function saveVideoImageProvider(projectId: string, versionId: string, id: string, revision: number, provider: string) {
  const { scope } = await videoContext(projectId, versionId);
  try { return { job: publicJob(await editJob(id, scope, revision, job => selectImageProvider(job, provider))) }; }
  catch (e) { return { error: message(e) }; }
}
export async function saveVideoPrompts(projectId: string, versionId: string, id: string, revision: number, prompts: { id: string; prompt: string }[]) {
  const { scope } = await videoContext(projectId, versionId);
  try {
    const job = await editJob(id, scope, revision, job => {
      if (!Array.isArray(prompts) || prompts.length !== job.shots.length || new Set(prompts.map(p => p.id)).size !== prompts.length) throw new Error('Некорректный набор кадров.');
      for (const shot of job.shots) {
        const input = prompts.find(p => p.id === shot.id);
        if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > productionLimits.prompt) throw new Error(`Описание кадра должно содержать от 1 до ${productionLimits.prompt} символов.`);
        shot.prompt = input.prompt.trim();
      }
      job.message = 'Описания сохранены. Изображения не перегенерировались.';
    });
    return { job: publicJob(job) };
  } catch (e) { return { error: message(e) }; }
}
export async function startVideoOperation(projectId: string, versionId: string, id: string, revision: number, kind: VideoOperation['kind'], budgetUSD: number, paidConfirmed: boolean, shotId?: string) {
  const { scope } = await videoContext(projectId, versionId);
  try {
    if (!(await workerOnline())) throw new Error('Запустите обработчик командой npm run video:worker в отдельном терминале.');
    const config = providerConfig();
    const job = await editJob(id, scope, revision, job => {
      const needs = requiredProviders(job, kind);
      if (createsMaterials(job, kind) && !config.enabled) throw new Error('Генерация выключена. Установите VIDEO_GENERATION_ENABLED=true и перезапустите приложение и обработчик.');
      if (needs.speech && !config.elevenKey) throw new Error('Для озвучки нужен ELEVENLABS_API_KEY. Ключ изображений для отдельной озвучки не требуется.');
      for (const provider of neededImageProviders(job, kind)) if (!imageAdapter(provider, config).configured) throw new Error(`Подключите ${imageCatalog[provider].label}: ${imageCatalog[provider].setup}.`);
      queueOperation(job, { kind, shotId, budgetUSD, reservedUSD: 0 }, paidConfirmed === true);
    });
    return { job: publicJob(job) };
  } catch (e) { return { error: message(e) }; }
}
