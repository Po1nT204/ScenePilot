'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import type { VideoView } from '@/lib/production/model';
import { flowCameraMoves, type FlowCameraMove } from '@/lib/production/flow-handoff';
import { assignmentProblems, batchClipLimit, importClipBatch, suggestClipShot, uploadVideoClip, type ClipAssignment } from '@/lib/production/flow-batch';

type Row = ClipAssignment & { status: 'waiting' | 'uploading' | 'saved' | 'failed'; message?: string };
function LocalClip({ file }: { file: File }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const url = URL.createObjectURL(file); element.src = url;
    return () => { element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); };
  }, [file]);
  return <video ref={video} className="batch-clip-preview" controls muted preload="metadata" aria-label={`Просмотр ${file.name}`} />;
}
function ClipPreview({ file }: { file: File }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>Просмотреть клип</summary>{open && <LocalClip file={file} />}</details>;
}

export function FlowBatch({ job, projectId, versionId, disabled, onBusy, onJob, onRefresh }: {
  job: VideoView; projectId: string; versionId: string; disabled: boolean;
  onBusy: (busy: boolean) => void; onJob: (job: VideoView) => void; onRefresh: () => Promise<boolean>;
}) {
  const id = useId(), stop = useRef(false), workingRef = useRef(false);
  const [camera, setCamera] = useState<FlowCameraMove>('still');
  const [working, setWorking] = useState<'export' | 'import' | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [replace, setReplace] = useState(false), [needsReview, setNeedsReview] = useState(false);
  const [checking, setChecking] = useState(false), [message, setMessage] = useState('');
  const [stopRequested, setStopRequested] = useState(false);
  const images = job.shots.filter(shot => shot.image.file).length;
  const pendingRows = rows.filter(row => row.status === 'waiting');
  const problems = assignmentProblems(rows, job);
  const replacing = pendingRows.filter(row => job.shots.find(shot => shot.id === row.shotId)?.clip).length;
  const locked = disabled || !!working || checking;
  const savedCount = rows.filter(row => row.status === 'saved').length;

  useEffect(() => () => { stop.current = true; }, []);
  useEffect(() => {
    if (!working) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [working]);
  function begin(kind: 'export' | 'import') { workingRef.current = true; setWorking(kind); onBusy(true); setMessage(''); }
  function finish() { workingRef.current = false; setWorking(null); onBusy(false); }
  async function download() {
    if (disabled || workingRef.current || !images) return;
    begin('export');
    try {
      const query = new URLSearchParams({ version: versionId, revision: String(job.revision), camera });
      const response = await fetch(`/projects/${projectId}/video/flow/${job.id}?${query}`, { redirect: 'error', signal: AbortSignal.timeout(180000) });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/zip')) {
        const error = response.headers.get('content-type')?.includes('application/json') ? (await response.json()).error : '';
        throw new Error(typeof error === 'string' && error ? error : 'Пакет не получен. Проверьте вход и обновите состояние сборки.');
      }
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `scenepilot-flow-${job.id}.zip`; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage('Пакет передан браузеру. Распакуйте ZIP: изображения и промпты готовы для переноса в Flow.');
      toast.success('Пакет Flow подготовлен');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Не удалось скачать пакет.';
      setMessage(text); toast.error('Пакет не скачан', { description: text });
    } finally { finish(); }
  }
  function choose(files: File[]) {
    if (locked || needsReview) return;
    if (files.length > batchClipLimit) { setMessage(`Выберите не больше ${batchClipLimit} MP4 за один раз.`); return; }
    if (!files.length) return;
    setRows(files.map((file, index) => ({ key: `${index}-${file.name}`, file, shotId: suggestClipShot(file.name, job), status: 'waiting' })));
    setReplace(false); setMessage('Проверьте каждый кадр перед импортом. Имена из пакета сопоставлены автоматически; порядок выбора файлов не используется.');
  }
  async function upload() {
    if (disabled || workingRef.current || needsReview || !pendingRows.length || problems.some(Boolean) || rows.some(row => row.status === 'failed') || (replacing > 0 && !replace)) return;
    begin('import'); stop.current = false; setStopRequested(false);
    try {
      const result = await importClipBatch(job, pendingRows, {
        upload: (current, row) => uploadVideoClip(projectId, versionId, current, row.shotId, row.file),
        stop: () => stop.current,
        started: row => setRows(old => old.map(item => item.key === row.key ? { ...item, status: 'uploading' } : item)),
        saved: (row, next) => {
          onJob(next);
          setRows(old => old.map(item => item.key === row.key ? { ...item, status: 'saved' } : item));
        },
      });
      if (result.failedKey) {
        setRows(old => old.map(item => item.key === result.failedKey ? { ...item, status: 'failed', message: result.error } : item));
        setNeedsReview(true);
        setMessage(`Импорт остановлен. Подтверждено файлов: ${savedCount + result.completed}. Проверьте состояние кадра с ошибкой перед повтором; остальные файлы не отправлены.`);
        toast.error('Импорт остановлен', { description: result.error });
      } else {
        setMessage(result.stopped ? `Импорт приостановлен. Сохранено: ${savedCount + result.completed}. Остальные можно загрузить позже.` : `Сохранено клипов: ${savedCount + result.completed}. Теперь можно перейти к сборке видео.`);
        toast.success(result.stopped ? 'Импорт приостановлен' : 'Клипы добавлены');
      }
    } catch {
      setNeedsReview(true); setMessage('Импорт не подтверждён. Проверьте состояние сборки перед повтором.');
    } finally { finish(); }
  }
  async function check() {
    setChecking(true);
    try {
      if (await onRefresh()) { setNeedsReview(false); setMessage('Состояние обновлено. Проверьте клип в кадре ниже. Выберите заново только недостающие файлы; сохранённые повторять не нужно.'); }
      else setMessage('Состояние не получено. Повторите проверку позже; импорт не возобновлён.');
    } finally { setChecking(false); }
  }
  return <section className="flow-batch" aria-label="Пакетная работа с клипами">
    <div className="flow-batch-heading"><div><p className="eyebrow">МЕНЬШЕ ПЕРЕНОСОВ</p><h4>Все кадры — одним пакетом</h4></div><span className="version-badge">{images} / {job.shots.length} изображений</span></div>
    <p className="video-muted">Скачайте изображения с промптами для Flow. После генерации выберите несколько MP4 и распределите их по кадрам.</p>
    <div className="flow-batch-export"><div><label htmlFor={`${id}-camera`}>Камера для промптов пакета</label><select id={`${id}-camera`} value={camera} disabled={locked} onChange={event => setCamera(event.target.value as FlowCameraMove)}>{Object.entries(flowCameraMoves).map(([value, move]) => <option key={value} value={value}>{move.label}</option>)}</select></div>
      <button type="button" className="button secondary" disabled={locked || !images} onClick={() => void download()}>{working === 'export' ? 'Готовим пакет…' : 'Скачать пакет Flow · ZIP'}</button>
    </div>
    <p className="video-muted">В ZIP попадут {images} готовых изображений и промпты движения.{images < job.shots.length && ` Кадров без изображения: ${job.shots.length - images}.`} Генерация выполняется в вашем Flow и расходует его кредиты.</p>
    <details className="flow-batch-guide"><summary>Как перенести пакет</summary><ol><li>Распакуйте ZIP и добавьте изображения в <a href="https://labs.google/fx/tools/flow" target="_blank" rel="noreferrer">Google Flow ↗</a>. Промпты лежат в prompts.txt и отдельных TXT.</li><li>Перед генерацией выберите модель и проверьте расход кредитов.</li><li>Назовите каждый MP4 так же, как соответствующее изображение. Тогда ScenePilot предложит нужный кадр автоматически. Для других имён выберите кадры вручную.</li><li>Если скачали из Flow архив, распакуйте его и выберите MP4 ниже.</li></ol></details>
    <div className="flow-batch-import">
      <h4>Добавить несколько MP4</h4><p className="video-muted">До 120 файлов, каждый до 32 МиБ и 60 секунд. Короткие клипы подгоняются под озвучку при монтаже. Для готовых клипов изображения не обязательны.</p>
      <label htmlFor={`${id}-files`}>{rows.length ? 'Выбрать файлы заново' : 'Выберите клипы'}</label><input id={`${id}-files`} type="file" multiple accept="video/mp4,.mp4" disabled={locked || needsReview} onChange={event => { choose(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      {!!rows.length && <><ol className="batch-file-list">{rows.map((row, index) => {
        const shot = job.shots.find(item => item.id === row.shotId), number = job.shots.findIndex(item => item.id === row.shotId) + 1;
        return <li key={row.key} className="batch-file-row"><div className="batch-file-info"><strong>{row.file.name}</strong><small>{(row.file.size / 1024 / 1024).toFixed(1)} МиБ · {row.status === 'saved' ? 'Сохранён' : row.status === 'uploading' ? 'Загружается…' : row.status === 'failed' ? 'Сохранение не подтверждено' : 'Ожидает импорта'}</small><ClipPreview file={row.file} /></div>
          <div className="batch-file-target"><label htmlFor={`${id}-target-${index}`}>Кадр для файла {index + 1}</label><select id={`${id}-target-${index}`} value={row.shotId} disabled={locked || row.status !== 'waiting' || needsReview} aria-invalid={!!problems[index]} aria-describedby={problems[index] ? `${id}-problem-${index}` : undefined} onChange={event => { setRows(old => old.map(item => item.key === row.key ? { ...item, shotId: event.target.value } : item)); setReplace(false); }}><option value="">Выберите кадр</option>{job.shots.map((item, i) => <option key={item.id} value={item.id}>Кадр {i + 1}{item.clip ? ' · есть клип' : ''} — {item.text.slice(0, 65)}</option>)}</select>
          {shot && <div className="batch-target-preview">{shot.image.file && <Image unoptimized width={120} height={68} src={`/projects/${projectId}/video/assets/${job.id}/${shot.image.file}?version=${versionId}`} alt={`Изображение кадра ${number}`} />}<p>{shot.text.slice(0, 180)}{shot.text.length > 180 ? '…' : ''}</p></div>}
          {problems[index] && <p className="field-error" id={`${id}-problem-${index}`}>{problems[index]}</p>}{row.message && <p className="field-error">{row.message}</p>}
          </div>{row.status === 'waiting' && <button type="button" className="video-text-button" disabled={locked || needsReview} aria-label={`Убрать файл ${row.file.name} из списка`} onClick={() => { setRows(old => old.filter(item => item.key !== row.key)); setReplace(false); }}>Убрать</button>}</li>;
      })}</ol>
      {replacing > 0 && <label className="batch-replace"><input type="checkbox" checked={replace} disabled={locked || needsReview} onChange={event => setReplace(event.target.checked)} />Заменить выбранные клипы ({replacing}). Озвучка сохранится; MP4 потребуется собрать заново.</label>}
      <div className="video-step-actions"><button type="button" className="button" disabled={locked || needsReview || !pendingRows.length || problems.some(Boolean) || rows.some(row => row.status === 'failed') || (replacing > 0 && !replace)} onClick={() => void upload()}>{working === 'import' ? `Импорт: ${savedCount} из ${rows.length}` : `Импортировать выбранные · ${pendingRows.length}`}</button>
      {working === 'import' && <button type="button" className="video-text-button" disabled={stopRequested} onClick={() => { stop.current = true; setStopRequested(true); }}>{stopRequested ? 'Остановимся после текущего файла…' : 'Остановить после текущего'}</button>}
      {!working && !needsReview && <button type="button" className="video-text-button" disabled={locked} onClick={() => { setRows([]); setReplace(false); setMessage(''); }}>Очистить список</button>}</div></>}
      {needsReview && <button type="button" className="video-text-button" disabled={locked} onClick={() => void check()}>Проверить состояние перед повтором</button>}
      {message && <p role="status" className="video-muted">{message}</p>}
    </div>
  </section>;
}
