'use server';
import { videoContext } from '@/lib/production/context';
import { createJob, editJob, listJobs, workerOnline, queueOperation } from '@/lib/production/store';
import { publicJob, estimatedCost, productionLimits, type VideoOperation } from '@/lib/production/model';
import { providerConfig } from '@/lib/production/providers';

function message(error: unknown) {
  if (error instanceof Error && !('code' in error) && !(error instanceof SyntaxError)) return error.message;
  return 'Не удалось прочитать или сохранить материалы. Проверьте доступ к локальной папке ScenePilot.';
}
export async function videoState(projectId: string, versionId: string) {
  const { scope } = await videoContext(projectId, versionId);
  try {
    const config = providerConfig();
    return { jobs: (await listJobs(scope)).slice(0, 20).map(publicJob), setup: { enabled: config.enabled, speech: !!config.elevenKey, images: !!config.bflKey, workerOnline: await workerOnline() } };
  } catch (e) { return { error: message(e) }; }
}
export async function newVideo(projectId: string, versionId: string, voiceId: string) {
  const { scope, project, version } = await videoContext(projectId, versionId);
  try {
    const job = await createJob(scope, { title: project.title, script: version.content, source: version.source || 'unknown', voiceId: typeof voiceId === 'string' ? voiceId.trim() : '' });
    return { job: publicJob(job) };
  } catch (e) { return { error: message(e) }; }
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
      const cost = estimatedCost(job, kind, shotId);
      if (cost > 0 && (!config.enabled || !config.bflKey || (kind === 'generate' && !job.audio.file && !config.elevenKey))) throw new Error('Реальная генерация не подключена. Настройте провайдеров локально по инструкции в разделе «Подключение».');
      if (kind === 'check' && !config.bflKey) throw new Error('Для проверки задач нужен ключ BFL.');
      queueOperation(job, { kind, shotId, budgetUSD, reservedUSD: 0 }, paidConfirmed === true);
    });
    return { job: publicJob(job) };
  } catch (e) { return { error: message(e) }; }
}
