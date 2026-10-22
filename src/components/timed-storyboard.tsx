'use client';
import { useState } from 'react';
import { createVideoStoryboard, previewVideoStoryboard } from '@/app/projects/[id]/video/actions';
import { storyboardTargets, type StoryboardSummary } from '@/lib/production/timed-storyboard';
import type { VideoView } from '@/lib/production/model';

export function TimedStoryboard({ job, projectId, versionId, disabled, onCreated, onBusy }: {
  job: VideoView; projectId: string; versionId: string; disabled: boolean; onCreated: (job: VideoView) => void; onBusy: (busy: boolean) => void;
}) {
  const [target, setTarget] = useState(8), [summary, setSummary] = useState<StoryboardSummary>();
  const [error, setError] = useState('');
  async function run(create: boolean) {
    onBusy(true); setError('');
    try {
      if (create) {
        const result = await createVideoStoryboard(projectId, versionId, job.id, job.revision, target);
        if (result.error) setError(result.error); else onCreated(result.job!);
      } else {
        const result = await previewVideoStoryboard(projectId, versionId, job.id, job.revision, target);
        if (result.error) setError(result.error); else setSummary(result.summary);
      }
    } catch { setError('Не удалось получить результат. Обновите состояние и повторите расчёт.'); }
    finally { onBusy(false); }
  }
  return <details className="video-connection">
    <summary>Разделить длинные кадры · необязательно</summary>
    <p>Делит длинные кадры по готовой озвучке. Это необязательный шаг: подгонка клипов работает и без него. Текст и голос сохраняются.</p>
    <p className="video-muted">Разделение не придумывает новые ракурсы: описания наследуются от исходного кадра. Перед генерацией задайте каждому новому кадру отдельный визуальный смысл. Независимые генерации Cloudflare могут менять лица и детали; одинаковый промпт не гарантирует единого персонажа.</p>
    <label htmlFor="storyboard-target">Ориентир длительности кадра</label>
    <select id="storyboard-target" value={target} disabled={disabled} onChange={e => { setTarget(Number(e.target.value)); setSummary(undefined); }}>
      {storyboardTargets.map(n => <option key={n} value={n}>{n} секунд</option>)}
    </select>
    <button type="button" className="button secondary" disabled={disabled || !job.audio.file} onClick={() => void run(false)}>Рассчитать без генерации</button>
    {!job.audio.file && <p className="video-muted">Сначала создайте озвучку — нужны её реальные тайминги.</p>}
    {summary && <div role="status">
      <p>Кадров: {summary.before} → {summary.after}. Сохранится материалов: {summary.retained}. Новых изображений потребуется: {summary.missing}. Самый длинный кадр: {summary.longest.toFixed(1)} с.</p>
      <p className="video-muted">Разделение идёт по словам и предложениям; длинное слово или пауза могут превышать ориентир. Описания новых кадров шаблонные — проверьте их. Генерация новых изображений расходует квоту выбранного сервиса.</p>
      <button type="button" className="button secondary" disabled={disabled || summary.after === summary.before} onClick={() => void run(true)}>Создать отдельную сборку с этой озвучкой</button>
      {summary.after === summary.before && <p>Кадры уже достаточно короткие.</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
