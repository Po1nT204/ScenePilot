import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { type VideoJob, type Asset, productionRates, assetsReady, roundCost } from './model';
import { atomicWrite, jobDirectory, saveJob } from './store';
import { synthesize, ProviderError, type ProviderConfig } from './providers';
import { imageAdapter } from './image-registry';
import type { ImageAdapter, ImageResult } from './image-adapter';
import { imageCatalog, selectedImageProvider, type ImageProviderId } from './image-catalog';
import { renderVideo } from './render';
import { imagePrompt } from './visual-style';

export type ProductionServices = {
  config: ProviderConfig; speech: typeof synthesize; image: (id: ImageProviderId) => ImageAdapter;
  render: typeof renderVideo; sleep: (ms: number) => Promise<void>;
};
export const services = (config: ProviderConfig): ProductionServices => ({ config, speech: synthesize, image: id => imageAdapter(id, config), render: renderVideo, sleep: ms => new Promise(r => setTimeout(r, ms)) });
export function recoverJob(job: VideoJob) {
  if (job.status !== 'running') return false;
  for (const asset of [job.audio, ...job.shots.map(s => s.image)]) {
    if (asset.state === 'requesting') asset.state = asset !== job.audio && (asset.pollingUrl || asset.requestId) ? 'pending' : 'unknown';
  }
  job.status = 'failed'; job.message = 'Обработчик был остановлен. Материалы сохранены. Проверьте состояние; платные запросы автоматически не повторяются.';
  job.operation = undefined; return true;
}
export async function processJob(job: VideoJob, root: string, deps: ProductionServices) {
  const op = job.operation;
  if (job.status !== 'queued' || !op) return;
  const persist = () => saveJob(job, root);
  const reserve = async (kind: 'speech' | 'image', asset: Asset, shotId?: string, provider?: ImageProviderId) => {
    const cost = kind === 'speech' ? roundCost(job.text.length / 1000 * productionRates.speechPerThousand) : imageCatalog[provider!].estimatedUSD;
    if (!deps.config.enabled || !(kind === 'speech' ? deps.config.elevenKey : deps.image(provider!).configured)) throw new Error('Генерация выключена или не настроены ключи выбранного провайдера.');
    if (roundCost(op.reservedUSD + cost) > op.budgetUSD) throw new Error('Следующий запрос превышает подтверждённый предел оценки расходов.');
    op.reservedUSD = roundCost(op.reservedUSD + cost);
    job.attempts.push({ id: randomUUID(), kind, shotId, provider, model: provider ? imageCatalog[provider].model : 'eleven_multilingual_v2', estimatedUSD: cost, at: new Date().toISOString() });
    asset.state = 'requesting'; await persist(); // Must reach disk before any billable request.
  };
  let activeAsset: Asset | undefined;
  try {
    job.status = 'running'; job.message = 'Подготовка'; await persist();
    if (op.kind === 'render') {
      const rendered = await deps.render(job, root, async message => { job.message = message; await persist(); });
      job.output = rendered.output; job.subtitles = rendered.subtitles; job.outputStale = false;
      job.status = 'ready'; job.message = 'Видео готово. Посмотрите и скачайте результат.';
    } else {
      if ((op.kind === 'generate' || op.kind === 'speech') && !job.audio.file) {
        if (['requesting', 'unknown'].includes(job.audio.state)) throw new Error('Результат предыдущей озвучки неизвестен. Новый запрос не отправлен.');
        activeAsset = job.audio; job.message = 'ElevenLabs: озвучка и тайминги';
        await reserve('speech', activeAsset);
        const result = await deps.speech(job.text, job.voiceId, deps.config.elevenKey);
        const file = `${randomUUID()}.mp3`; await atomicWrite(join(jobDirectory(job.id, root), file), result.bytes);
        Object.assign(job.audio, { file, state: 'ready', requestId: result.requestId });
        job.alignment = result.alignment; job.outputStale = !!job.output; await persist(); activeAsset = undefined;
      }
      for (const shot of job.shots) {
        if (op.kind === 'speech') break;
        if (op.kind === 'replace' && shot.id !== op.shotId) continue;
        if (op.kind === 'check' && shot.image.state !== 'pending' && !shot.image.pollingUrl) continue;
        if (op.kind !== 'replace' && shot.image.file && shot.image.state !== 'pending') continue;
        activeAsset = shot.image;
        let completed = false;
        const saveImage = async (result: ImageResult, provider: ImageProviderId) => {
          const file = `${randomUUID()}.${result.extension}`;
          await atomicWrite(join(jobDirectory(job.id, root), file), result.bytes);
          Object.assign(shot.image, { file, state: 'ready', provider, pollingUrl: undefined, requestedProvider: undefined, generatedPrompt: shot.image.requestedPrompt || shot.prompt, requestedPrompt: undefined });
          job.outputStale = !!job.output; await persist(); completed = true;
        };
        if (shot.image.state !== 'pending' && !shot.image.pollingUrl) {
          if (op.kind === 'check') continue;
          if (['requesting', 'unknown'].includes(shot.image.state)) throw new Error('Результат запроса изображения неизвестен. Повтор возможен только отдельным действием замены.');
          const provider = selectedImageProvider(job);
          if (provider === 'none') throw new Error('Выберите модуль изображений перед генерацией.');
          job.message = `${imageCatalog[provider].label}: кадр ${job.shots.indexOf(shot) + 1} из ${job.shots.length}`;
          const prompt = imagePrompt(shot.prompt, job.visualStyle);
          if (prompt.length > 2000) throw new Error('Описание со стилем превышает 2000 символов. Сократите описание кадра.');
          shot.image.requestedPrompt = prompt;
          shot.image.requestedProvider = provider;
          await reserve('image', shot.image, shot.id, provider);
          const submitted = await deps.image(provider).submit(prompt);
          if (submitted.pending) { Object.assign(shot.image, submitted.task, { state: 'pending' }); await persist(); }
          else await saveImage(submitted, provider);
        }
        const deadline = Date.now() + 5 * 60 * 1000;
        for (let n = 0; !completed && n < 150 && Date.now() < deadline; n++) {
          // A task belongs to the provider that accepted it, even after selection changes.
          const provider = shot.image.requestedProvider || shot.image.provider || 'bfl-flux11';
          const adapter = deps.image(provider);
          if (!adapter.configured) throw new Error(`Для проверки существующей задачи подключите ${imageCatalog[provider].label}.`);
          const result = await adapter.poll({ requestId: shot.image.requestId || '', pollingUrl: shot.image.pollingUrl });
          if (result.pending) { await deps.sleep(2000); continue; }
          await saveImage(result, provider);
        }
        if (!completed) throw new Error('Сервис ещё обрабатывает изображение. Нажмите «Проверить задачи изображений» позже; это не новый запрос генерации.');
        activeAsset = undefined;
      }
      job.status = assetsReady(job) ? 'materials' : 'draft';
      job.message = op.kind === 'speech' ? 'Озвучка сохранена. Прослушайте её перед созданием изображений.' : assetsReady(job) ? 'Материалы готовы. Прослушайте озвучку и соберите видео.' : op.kind === 'replace' ? 'Изображение сохранено. Оцените кадр, затем создайте остальные материалы.' : 'Состояние обновлено. Недостающие материалы можно создать отдельно.';
    }
  } catch (error) {
    if (activeAsset?.state === 'requesting') activeAsset.state = error instanceof ProviderError && !error.uncertain ? 'failed' : 'unknown';
    if (activeAsset?.state === 'pending' && error instanceof ProviderError && error.imageTaskFinished) {
      activeAsset.state = 'failed'; activeAsset.pollingUrl = undefined;
    }
    job.status = 'failed'; job.message = error instanceof Error ? error.message : 'Производство остановлено. Готовые материалы сохранены.';
  }
  job.operation = undefined; await persist();
}
