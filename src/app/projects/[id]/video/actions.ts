'use server';
import { unstable_rethrow } from 'next/navigation';
import { videoContext } from '@/lib/production/context';
import { selectVisual, fitAllClips } from '@/lib/production/clips';
import { createJob, editJob, listJobs, workerOnline, queueOperation, selectImageProvider, saveAppearance } from '@/lib/production/store';
import { imagePrompt } from '@/lib/production/visual-style';
import { publicJob, createsMaterials, requiredProviders, neededImageProviders, productionLimits, type VideoOperation } from '@/lib/production/model';
import { providerConfig } from '@/lib/production/providers';
import { checkSpeechConnection } from '@/lib/production/connection';
import { imageAdapter, imageAvailability } from '@/lib/production/image-registry';
import { isImageProvider, validImageSelection, imageCatalog, type ImageSelection } from '@/lib/production/image-catalog';

function message(error: unknown) {
  unstable_rethrow(error);
  if (error instanceof Error && !('code' in error) && !(error instanceof SyntaxError)) return error.message;
  return 'Не удалось прочитать или сохранить материалы. Проверьте доступ к локальной папке ScenePilot.';
}
export async function videoState(projectId: string, versionId: string) {
  try {
    const { scope } = await videoContext(projectId, versionId);
    const config = providerConfig();
    const imageProviders = imageAvailability(config);
    return { jobs: (await listJobs(scope)).slice(0, 20).map(publicJob), setup: { enabled: config.enabled, speech: !!config.elevenKey, images: Object.values(imageProviders).some(Boolean), imageProviders, workerOnline: await workerOnline() } };
  } catch (e) { return { error: message(e) }; }
}
export async function checkVideoSpeechConnection(projectId: string, versionId: string, voiceId: string) {
  try {
    await videoContext(projectId, versionId);
    return { connection: await checkSpeechConnection(typeof voiceId === 'string' ? voiceId.trim() : '', providerConfig().elevenKey) };
  } catch (e) { return { error: message(e) }; }
}
export async function checkVideoImageConnection(projectId: string, versionId: string, provider: string) {
  try {
    await videoContext(projectId, versionId);
    if (!isImageProvider(provider)) throw new Error('Выберите модуль изображений для проверки.');
    return { connection: await imageAdapter(provider, providerConfig()).checkConnection() };
  } catch (e) { return { error: message(e) }; }
}
export async function newVideo(projectId: string, versionId: string, voiceId: string, imageProvider: ImageSelection = 'none') {
  try {
    const { scope, project, version } = await videoContext(projectId, versionId);
    if (!validImageSelection(imageProvider)) throw new Error('Неизвестный модуль изображений.');
    const job = await createJob(scope, { title: project.title, script: version.content, source: version.source || 'unknown', voiceId: typeof voiceId === 'string' ? voiceId.trim() : '', imageProvider });
    return { job: publicJob(job) };
  } catch (e) { return { error: message(e) }; }
}
export async function saveVideoImageProvider(projectId: string, versionId: string, id: string, revision: number, provider: string) {
  try {
    const { scope } = await videoContext(projectId, versionId); return { job: publicJob(await editJob(id, scope, revision, job => selectImageProvider(job, provider))) }; }
  catch (e) { return { error: message(e) }; }
}
export async function saveVideoPrompts(projectId: string, versionId: string, id: string, revision: number, prompts: { id: string; prompt: string }[]) {
  try {
    const { scope } = await videoContext(projectId, versionId);
    const job = await editJob(id, scope, revision, job => {
      if (!Array.isArray(prompts) || prompts.length !== job.shots.length || new Set(prompts.map(p => p.id)).size !== prompts.length) throw new Error('Некорректный набор кадров.');
      for (const shot of job.shots) {
        const input = prompts.find(p => p.id === shot.id);
        if (!input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > productionLimits.prompt) throw new Error(`Описание кадра должно содержать от 1 до ${productionLimits.prompt} символов.`);
        if (imagePrompt(input.prompt.trim(), job.visualStyle).length > productionLimits.prompt) throw new Error('Описание вместе с выбранным стилем превышает 2000 символов. Сократите описание.');
        shot.prompt = input.prompt.trim();
      }
      job.message = 'Описания сохранены. Изображения не перегенерировались.';
    });
    return { job: publicJob(job) };
  } catch (e) { return { error: message(e) }; }
}
export async function saveVideoAppearance(projectId: string, versionId: string, id: string, revision: number, style: string, subtitles: boolean) {
  try {
    const { scope } = await videoContext(projectId, versionId); return { job: publicJob(await editJob(id, scope, revision, job => saveAppearance(job, style, subtitles))) }; }
  catch (e) { return { error: message(e) }; }
}
export async function saveVideoVisual(projectId: string, versionId: string, id: string, revision: number, shotId: string, visual: string, tail: string) {
  try {
    const { scope } = await videoContext(projectId, versionId); return { job: publicJob(await editJob(id, scope, revision, job => selectVisual(job, shotId, visual, tail))) }; }
  catch (e) { return { error: message(e) }; }
}
export async function fitVideoClips(projectId: string, versionId: string, id: string, revision: number) {
  try {
    const { scope } = await videoContext(projectId, versionId);
    return { job: publicJob(await editJob(id, scope, revision, fitAllClips)) };
  } catch (e) { return { error: message(e) }; }
}
export async function startVideoOperation(projectId: string, versionId: string, id: string, revision: number, kind: VideoOperation['kind'], budgetUSD: number, paidConfirmed: boolean, shotId?: string) {
  try {
    const { scope } = await videoContext(projectId, versionId);
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
