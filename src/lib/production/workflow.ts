import { hasVisual, usesClip, type VideoView } from './model';

export const videoStages = [
  ['plan', '01', 'Сценарий'], ['speech', '02', 'Озвучка'],
  ['frames', '03', 'Кадры'], ['motion', '04', 'Анимация'], ['result', '05', 'Сборка'],
] as const;
export type VideoStage = typeof videoStages[number][0];

export function suggestedVideoStage(job?: VideoView): VideoStage {
  if (!job) return 'plan';
  if (job.operation?.kind === 'render') return 'result';
  if (!job.audio.file) return 'speech';
  if (job.shots.some(s => !hasVisual(s))) return 'frames';
  if (job.output) return 'result';
  return 'motion';
}

export function videoStageProgress(job?: VideoView): Record<VideoStage, string> {
  return {
    plan: job ? 'План готов' : 'Начните здесь',
    speech: job?.audio.file ? 'Готово' : 'Нужен голос',
    frames: job ? `${job.shots.filter(hasVisual).length} / ${job.shots.length}` : 'Нет материалов',
    motion: job?.shots.some(usesClip) ? `Клипов: ${job.shots.filter(usesClip).length}` : 'Необязательно',
    result: job?.output ? job.outputStale ? 'Нужно пересобрать' : 'MP4 готов' : 'Экспорт MP4',
  };
}
