'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type VideoView, usesClip } from '@/lib/production/model';
import { frameImageFromTransfer, uploadFrameImage } from '@/lib/production/frame-transfer';
import { FrameImagePreview } from './frame-image-preview';

export function FrameImageInput({ job, shotId, number, projectId, versionId, disabled, onBusy, onJob, onRefresh }: {
  job: VideoView; shotId: string; number: number; projectId: string; versionId: string; disabled: boolean;
  onBusy: (value: boolean) => void; onJob: (value: VideoView) => void; onRefresh: () => Promise<boolean>;
}) {
  const id = useId(), active = useRef(false);
  const [candidate, setCandidate] = useState<{ file: File; revision: number }>();
  const [working, setWorking] = useState(false), [checking, setChecking] = useState(false), [review, setReview] = useState(false);
  const [message, setMessage] = useState('');
  const shot = job.shots.find(item => item.id === shotId);
  const pending = ['pending', 'requesting'].includes(shot?.image.state ?? '');
  const locked = disabled || working || checking || pending;
  const stale = !!candidate && candidate.revision !== job.revision;
  useEffect(() => {
    if (!working) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [working]);
  function choose(files: File[], clipboard = false) {
    if (locked || review || active.current) return;
    try { const file = frameImageFromTransfer(files, clipboard); setCandidate({ file, revision: job.revision }); setMessage('Проверьте изображение перед сохранением.'); }
    catch (error) { setCandidate(undefined); setMessage(error instanceof Error ? error.message : 'Не удалось прочитать изображение.'); }
  }
  async function save() {
    if (locked || review || active.current || !candidate || stale || !shot) return;
    active.current = true; setWorking(true); onBusy(true); setMessage('Сохраняем изображение…');
    try {
      const next = await uploadFrameImage(projectId, versionId, job, shotId, candidate.file);
      onJob(next); setCandidate(undefined);
      setMessage(usesClip(shot) ? 'Картинка сохранена. В монтаже остаётся MP4-клип; выбор материала — в «Анимации».' : 'Картинка сохранена. Озвучка осталась прежней.');
      toast.success(`Изображение кадра ${number} сохранено`);
    } catch (error) {
      setReview(true); setMessage(error instanceof Error ? error.message : 'Сохранение не подтверждено. Проверьте состояние кадра.');
      toast.error('Сохранение не подтверждено', { description: 'Проверьте состояние перед повтором.' });
    } finally { active.current = false; setWorking(false); onBusy(false); }
  }
  async function check() {
    if (locked || active.current) return;
    setChecking(true);
    try {
      if (await onRefresh()) { setCandidate(undefined); setReview(false); setMessage('Состояние обновлено. Проверьте картинку выше. Если её нет, вставьте изображение снова.'); }
      else setMessage('Не удалось обновить состояние. Повторите проверку позже.');
    } finally { setChecking(false); }
  }
  return <details className="frame-image-input">
    <summary>Вставить изображение из Flow</summary>
    <p className="video-muted">Скопируйте готовую картинку в Flow через «Копировать изображение». Нажмите на область ниже и вставьте Ctrl+V. Генерация на сайте остаётся ручной.</p>
    <div className="frame-image-drop" role="group" aria-label={`Вставка изображения в кадр ${number}`} aria-describedby={`${id}-hint`} aria-disabled={locked || review} tabIndex={locked || review ? -1 : 0}
      onClick={event => event.currentTarget.focus()}
      onPaste={event => { event.preventDefault(); event.stopPropagation(); choose(Array.from(event.clipboardData.files), true); }}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = locked || review ? 'none' : 'copy'; }}
      onDrop={event => { event.preventDefault(); event.stopPropagation(); choose(Array.from(event.dataTransfer.files)); }}>
      <strong>Кадр {number} · Ctrl+V или перетаскивание</strong>
      <span id={`${id}-hint`}>Одно изображение PNG, JPEG или WebP · до 16 МиБ</span>
    </div>
    <label className="frame-image-file" htmlFor={`${id}-file`}>Или выбрать файл<input id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={locked || review} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) choose(files); }} /></label>
    {candidate && <div className="frame-image-candidate"><FrameImagePreview file={candidate.file} />
      <p className="video-muted">{shot?.image.file ? `Заменит изображение кадра ${number}.` : `Будет добавлено в кадр ${number}.`} Озвучка и клипы сохранятся.</p>
      {stale && !review && <p className="field-error">Сборка изменилась. Проверьте кадр и выберите изображение заново.</p>}
      <div className="video-frame-actions"><button type="button" className="button secondary" disabled={locked || review || stale} onClick={() => void save()}>{working ? 'Сохраняем…' : shot?.image.file ? `Заменить изображение кадра ${number}` : `Добавить в кадр ${number}`}</button>
        <button type="button" className="video-text-button" disabled={locked || review} onClick={() => { setCandidate(undefined); setMessage(''); }}>Отменить выбор</button></div>
    </div>}
    {pending && <p className="video-muted">Сначала завершите проверку текущей задачи изображения.</p>}
    {review && <button type="button" className="video-text-button" disabled={locked} onClick={() => void check()}>Проверить состояние перед повтором</button>}
    {message && <p className="video-muted" role="status">{message}</p>}
  </details>;
}
