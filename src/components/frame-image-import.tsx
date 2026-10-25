'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { VideoView } from '@/lib/production/model';
import { assignmentProblems, importFileBatch, type FileAssignment } from '@/lib/production/flow-batch';
import { imageFileProblem, suggestImageShot, uploadFrameImage } from '@/lib/production/frame-transfer';

function FilePreview({ file }: { file: File }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = ref.current; if (!element || imageFileProblem(file)) return;
    const url = URL.createObjectURL(file); element.src = url;
    return () => { element.removeAttribute('src'); URL.revokeObjectURL(url); };
  }, [file]);
  // Local object URLs are previewed directly, never sent to the Next image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} width={160} height={90} className="frame-file-preview" alt={`Предпросмотр ${file.name}`} />;
}
type Row = FileAssignment & { state: 'waiting' | 'uploading' | 'saved' | 'failed'; message?: string };
export function FrameImageImport({ job, projectId, versionId, disabled, onBusy, onJob, onRefresh }: {
  job: VideoView; projectId: string; versionId: string; disabled: boolean;
  onBusy: (value: boolean) => void; onJob: (value: VideoView) => void; onRefresh: () => Promise<boolean>;
}) {
  const id = useId(), active = useRef(false), stop = useRef(false);
  const [rows, setRows] = useState<Row[]>([]), [working, setWorking] = useState(false), [stopping, setStopping] = useState(false);
  const [replace, setReplace] = useState(false), [review, setReview] = useState(false), [checking, setChecking] = useState(false), [message, setMessage] = useState('');
  const locked = disabled || working || checking, waiting = rows.filter(row => row.state === 'waiting');
  const problems = assignmentProblems(rows, job, imageFileProblem);
  const replacements = waiting.filter(row => job.shots.find(shot => shot.id === row.shotId)?.image.file).length;
  const savedCount = rows.filter(row => row.state === 'saved').length;
  useEffect(() => () => { stop.current = true; }, []);
  useEffect(() => { if (!working) return; const warn = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [working]);
  async function upload() {
    if (locked || active.current || review || !waiting.length || problems.some(Boolean) || (replacements > 0 && !replace)) return;
    active.current = true; stop.current = false; setWorking(true); setStopping(false); onBusy(true); setMessage('');
    try {
      const result = await importFileBatch(job, waiting, {
        validateFile: imageFileProblem, stop: () => stop.current,
        upload: (current, row) => uploadFrameImage(projectId, versionId, current, row.shotId, row.file),
        started: row => setRows(old => old.map(item => item.key === row.key ? { ...item, state: 'uploading' } : item)),
        saved: (row, next) => { onJob(next); setRows(old => old.map(item => item.key === row.key ? { ...item, state: 'saved' } : item)); },
      });
      if (result.failedKey) {
        setRows(old => old.map(row => row.key === result.failedKey ? { ...row, state: 'failed', message: result.error } : row)); setReview(true);
        setMessage(`Импорт остановлен. Подтверждено изображений: ${savedCount + result.completed}. Проверьте состояние перед повтором.`); toast.error('Импорт остановлен', { description: result.error });
      } else { setMessage(`${result.stopped ? 'Импорт приостановлен.' : 'Готово.'} Сохранено изображений: ${savedCount + result.completed}. Озвучка и клипы сохранены.`); toast.success(result.stopped ? 'Импорт приостановлен' : 'Изображения добавлены'); }
    } catch { setReview(true); setMessage('Сохранение не подтверждено. Проверьте состояние перед повтором.'); }
    finally { active.current = false; setWorking(false); onBusy(false); }
  }
  async function check() {
    setChecking(true);
    try { if (await onRefresh()) { setRows([]); setReview(false); setReplace(false); setMessage('Состояние обновлено. Проверьте кадры ниже и выберите заново только недостающие изображения.'); } else setMessage('Не удалось получить состояние. Повторите проверку позже.'); }
    finally { setChecking(false); }
  }
  return <details className="frame-import"><summary>Кадры из Flow или другого сервиса</summary>
    <p>В <a href="https://labs.google/fx/tools/flow" target="_blank" rel="noreferrer">Google Flow ↗</a> выберите «Изображение» и доступную Nano Banana. API-ключ для сайта не нужен; лимиты и расход проверьте в Flow. Начните с одного кадра, затем используйте его как референс для следующих.</p>
    <p className="video-muted">Промпт можно скопировать в карточке кадра ниже. Загрузите готовые PNG, JPEG или WebP вместе: до 120 файлов, каждый до 16 МиБ и 4096×4096. Предпочтительно 16:9; при монтаже края других пропорций обрезаются. Это импорт файлов, автоматическая генерация в Flow пока не подключена.</p>
    <label htmlFor={`${id}-files`}>Выбрать изображения</label><input id={`${id}-files`} type="file" multiple accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={locked || review} onChange={e => {
      const files = Array.from(e.target.files ?? []); e.target.value = '';
      if (!files.length) return;
      if (files.length > 120) { setMessage('Выберите не больше 120 изображений.'); return; }
      setRows(files.map((file, i) => ({ key: `${i}-${file.name}`, file, shotId: suggestImageShot(file.name, job), state: 'waiting' }))); setReplace(false); setMessage('Назначьте каждому изображению кадр. Порядок файлов не используется для сопоставления.');
    }} />
    {!!rows.length && <><ol className="batch-file-list">{rows.map((row, i) => <li className="batch-file-row" key={row.key}>
      <div className="batch-file-info"><FilePreview file={row.file} /><strong>{row.file.name}</strong><small>{row.state === 'saved' ? 'Сохранён' : row.state === 'uploading' ? 'Загружается…' : row.state === 'failed' ? 'Не подтверждён' : 'Ожидает импорта'}</small></div>
      <div className="batch-file-target"><label htmlFor={`${id}-${i}`}>Кадр для изображения {i + 1}</label><select id={`${id}-${i}`} value={row.shotId} disabled={locked || review || row.state !== 'waiting'} aria-invalid={!!problems[i]} onChange={e => { setRows(old => old.map(item => item.key === row.key ? { ...item, shotId: e.target.value } : item)); setReplace(false); }}><option value="">Выберите кадр</option>{job.shots.map((shot, n) => <option key={shot.id} value={shot.id}>Кадр {n + 1}{shot.image.file ? ' · есть изображение' : ''} — {shot.text.slice(0, 70)}</option>)}</select><p className="video-muted">{job.shots.find(s => s.id === row.shotId)?.text.slice(0, 180)}</p>{(problems[i] || row.message) && <p className="field-error">{problems[i] || row.message}</p>}</div>
      {row.state === 'waiting' && <button type="button" className="video-text-button" disabled={locked || review} aria-label={`Убрать ${row.file.name}`} onClick={() => { setRows(old => old.filter(item => item.key !== row.key)); setReplace(false); }}>Убрать</button>}
    </li>)}</ol>
    {replacements > 0 && <label className="batch-replace"><input type="checkbox" checked={replace} disabled={locked || review} onChange={e => setReplace(e.target.checked)} />Заменить изображения ({replacements}). Выбранные MP4-клипы останутся в монтаже.</label>}
    <div className="video-step-actions"><button className="button secondary" type="button" disabled={locked || review || !waiting.length || problems.some(Boolean) || (replacements > 0 && !replace)} onClick={() => void upload()}>{working ? `Импорт: ${savedCount} из ${rows.length}` : `Добавить изображения · ${waiting.length}`}</button>
      {working ? <button type="button" className="video-text-button" disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }}>{stopping ? 'Остановимся после текущего…' : 'Остановить после текущего'}</button> : <button type="button" className="video-text-button" disabled={locked || review} onClick={() => { setRows([]); setReplace(false); }}>Очистить список</button>}</div></>}
    {review && <button type="button" className="video-text-button" disabled={locked} onClick={() => void check()}>Проверить состояние перед повтором</button>}
    {message && <p role="status" className="video-muted">{message}</p>}
  </details>;
}
