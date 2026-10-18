import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { type VideoJob, type Asset, productionRates, assetsReady, roundCost } from './model';
import { atomicWrite, jobDirectory, saveJob } from './store';
import { synthesize, submitImage, checkImage, ProviderError, type ProviderConfig } from './providers';
import { renderVideo } from './render';

export type ProductionServices = {
  config: ProviderConfig; speech: typeof synthesize; submit: typeof submitImage; check: typeof checkImage;
  render: typeof renderVideo; sleep: (ms: number) => Promise<void>;
};
export const services = (config: ProviderConfig): ProductionServices => ({ config, speech: synthesize, submit: submitImage, check: checkImage, render: renderVideo, sleep: ms => new Promise(r => setTimeout(r, ms)) });
export function recoverJob(job: VideoJob) {
  if (job.status !== 'running') return false;
  for (const asset of [job.audio, ...job.shots.map(s => s.image)]) {
    if (asset.state === 'requesting') asset.state = asset.pollingUrl ? 'pending' : 'unknown';
  }
  job.status = 'failed'; job.message = 'Обработчик был остановлен. Материалы сохранены. Проверьте состояние; платные запросы автоматически не повторяются.';
  job.operation = undefined; return true;
}
export async function processJob(job: VideoJob, root: string, deps: ProductionServices) {
  const op = job.operation;
  if (job.status !== 'queued' || !op) return;
  const persist = () => saveJob(job, root);
  const reserve = async (kind: 'speech' | 'image', asset: Asset, shotId?: string) => {
    const cost = kind === 'speech' ? roundCost(job.text.length / 1000 * productionRates.speechPerThousand) : productionRates.image;
    if (!deps.config.enabled || !(kind === 'speech' ? deps.config.elevenKey : deps.config.bflKey)) throw new Error('Генерация выключена или не настроены ключи провайдера.');
    if (roundCost(op.reservedUSD + cost) > op.budgetUSD) throw new Error('Следующий запрос превышает подтверждённый предел оценки расходов.');
    op.reservedUSD = roundCost(op.reservedUSD + cost);
    job.attempts.push({ id: randomUUID(), kind, shotId, estimatedUSD: cost, at: new Date().toISOString() });
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
        if (op.kind === 'check' && !shot.image.pollingUrl) continue;
        if (op.kind !== 'replace' && shot.image.file && shot.image.state !== 'pending') continue;
        activeAsset = shot.image;
        if (!shot.image.pollingUrl) {
          if (op.kind === 'check') continue;
          if (['requesting', 'unknown'].includes(shot.image.state)) throw new Error('Результат запроса изображения неизвестен. Повтор возможен только отдельным действием замены.');
          job.message = `FLUX: кадр ${job.shots.indexOf(shot) + 1} из ${job.shots.length}`;
          shot.image.requestedPrompt = shot.prompt;
          await reserve('image', shot.image, shot.id);
          const submitted = await deps.submit(shot.prompt, deps.config.bflKey);
          Object.assign(shot.image, submitted, { state: 'pending' }); await persist();
        }
        let completed = false;
        const deadline = Date.now() + 5 * 60 * 1000;
        for (let n = 0; n < 150 && Date.now() < deadline; n++) {
          const result = await deps.check(shot.image.pollingUrl!, deps.config.bflKey);
          if (result.pending) { await deps.sleep(2000); continue; }
          const file = `${randomUUID()}.jpg`; await atomicWrite(join(jobDirectory(job.id, root), file), result.bytes);
          Object.assign(shot.image, { file, state: 'ready', pollingUrl: undefined, generatedPrompt: shot.image.requestedPrompt || shot.prompt, requestedPrompt: undefined });
          job.outputStale = !!job.output; await persist(); completed = true; break;
        }
        if (!completed) throw new Error('BFL ещё обрабатывает изображение. Нажмите «Проверить задачи BFL» позже; это не новый запрос генерации.');
        activeAsset = undefined;
      }
      job.status = assetsReady(job) ? 'materials' : 'draft';
      job.message = op.kind === 'speech' ? 'Озвучка сохранена. Прослушайте её перед созданием изображений.' : assetsReady(job) ? 'Материалы готовы. Прослушайте озвучку и соберите видео.' : 'Состояние обновлено. Недостающие материалы можно создать отдельно.';
    }
  } catch (error) {
    if (activeAsset?.state === 'requesting') activeAsset.state = error instanceof ProviderError && !error.uncertain ? 'failed' : 'unknown';
    job.status = 'failed'; job.message = error instanceof Error ? error.message : 'Производство остановлено. Готовые материалы сохранены.';
  }
  job.operation = undefined; await persist();
}
