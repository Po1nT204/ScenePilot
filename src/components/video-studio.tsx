'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { videoStages, suggestedVideoStage, videoStageProgress, type VideoStage } from '@/lib/production/workflow';
import { RunwayConnection } from './runway-connection';
import { TimedStoryboard } from './timed-storyboard';
import { FlowHandoff } from './flow-handoff';
import { FlowBatch } from './flow-batch';
import { FrameImageImport } from './frame-image-import';
import { FrameImageInput } from './frame-image-input';
import { FrameVisualGuide } from './frame-visual-guide';
import { VideoReleasePanel } from './video-release';
import { VideoSettingsTransfer } from './video-settings-transfer';
import type { ReleasePart, ReleaseView } from '@/lib/production/release-model';
import { framePromptForFlow } from '@/lib/production/frame-transfer';
import { clipFileProblem, uploadVideoClip } from '@/lib/production/flow-batch';
import { type VideoView, type VideoSetup, type VideoOperation, type SpeechConnection, hasVisual, usesClip, estimatedCost, requiredProviders, createsMaterials, createsImages, neededImageProviders, productionRates, productionLimits } from '@/lib/production/model';
import { planScriptChapters } from '@/lib/production/chapters';
import { formatDuration, narrationPace } from '@/lib/narration';
import { newVideo, saveVideoPrompts, startVideoOperation, videoState, checkVideoSpeechConnection, checkVideoImageConnection, saveVideoImageProvider, saveVideoAppearance, saveVideoVisual, fitVideoClips, assembleVideoRelease } from '@/app/projects/[id]/video/actions';
import { visualStyles, imagePrompt, type VisualStyle } from '@/lib/production/visual-style';

import { imageCatalog, imageBillingLabel, selectedImageProvider, imagePrice, type ImageProviderId, type ImageSelection } from '@/lib/production/image-catalog';
import { clipFit, videoFps } from '@/lib/production/clip-timing';
import type { ImageAccess } from '@/lib/production/image-adapter';

const statusLabel: Record<VideoView['status'], string> = { draft: 'План кадров', queued: 'В очереди', running: 'В работе', materials: 'Материалы готовы', ready: 'Видео готово', failed: 'Нужно внимание' };
const usd = (value: number) => '$' + value.toFixed(3).replace(/0$/, '');
export function VideoStudio({ projectId, versionId, script, scriptSource = 'unknown', initialJobs, initialSetup, initialParts = [], initialReleases = [], defaultVoice, planningPace = narrationPace.default }: {
  projectId: string; versionId: string; script: string; scriptSource?: string; initialJobs: VideoView[]; initialSetup: VideoSetup; initialParts?: ReleasePart[]; initialReleases?: ReleaseView[]; defaultVoice: string; planningPace?: number;
}) {
  const [jobs, setJobs] = useState(initialJobs), [selected, setSelected] = useState(initialJobs[0]?.id || '');
  const [parts, setParts] = useState(initialParts), [releases, setReleases] = useState(initialReleases);
  const [setup, setSetup] = useState(initialSetup), [voice, setVoice] = useState(defaultVoice);
  const [stage, setStage] = useState<VideoStage>(() => suggestedVideoStage(initialJobs[0]));
  const [storyboardBusy, setStoryboardBusy] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const transferBusyRef = useRef(false), refreshEpoch = useRef(0);
  const markTransferBusy = (value: boolean) => { transferBusyRef.current = value; refreshEpoch.current++; setTransferBusy(value); };
  const [planSource, setPlanSource] = useState<'script' | 'scenes'>('script');
  const [inheritSettings, setInheritSettings] = useState(true);
  const [chapterIndex, setChapterIndex] = useState(0);
  const chapterPlan = useMemo(() => {
    try { return { chapters: planScriptChapters(script, planningPace), error: '' }; }
    catch (error) { return { chapters: [], error: error instanceof Error ? error.message : 'Не удалось подготовить части сценария.' }; }
  }, [script, planningPace]);
  const multipart = planSource === 'script' && chapterPlan.chapters.length > 1;
  const chosenChapter = chapterPlan.chapters[chapterIndex];
  const [showConnections, setShowConnections] = useState(false);
  const [error, setError] = useState(''), [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({}), [draftRevision, setDraftRevision] = useState<number>();
  const [guideDraft, setGuideDraft] = useState<string>();
  const [budget, setBudget] = useState('1.00'), [confirmed, setConfirmed] = useState(false);
  const [connection, setConnection] = useState<SpeechConnection>();
  const [imageConnection, setImageConnection] = useState<ImageAccess>();
  const [newImageProvider, setNewImageProvider] = useState<ImageSelection>('none');
  const job = jobs.find(j => j.id === selected);
  const copyingSettings = !!job && inheritSettings;
  const provider = job ? selectedImageProvider(job) : newImageProvider;
  const providerInfo = provider === 'none' ? undefined : imageCatalog[provider];
  const imageConfigured = (id: ImageProviderId) => setup.imageProviders?.[id] ?? (id === 'bfl-flux11' && setup.images);
  const checkedImage = imageConnection?.provider === provider ? imageConnection : undefined;
  const guide = guideDraft ?? job?.visualGuide ?? '';
  const dirty = Object.keys(drafts).length > 0 || guideDraft !== undefined;
  const busy = transferBusy || storyboardBusy || pending || job?.status === 'queued' || job?.status === 'running';
  const cost = job ? stage === 'speech' ? estimatedCost(job, 'speech') : Math.max(0, estimatedCost(job, 'generate') - estimatedCost(job, 'speech')) : 0;
  const progress = videoStageProgress(job);
  const visualsReady = !!job && job.shots.every(hasVisual);
  const goTo = (next: VideoStage) => { if (transferBusyRef.current) return; setStage(next); setConfirmed(false); };
  const needs = job ? requiredProviders(job, 'generate') : { speech: true, images: true };
  const canGenerate = setup.enabled && (!needs.speech || setup.speech) && (!needs.images || (job && (!createsImages(job, 'generate') || provider !== 'none') && neededImageProviders(job, 'generate').every(imageConfigured))) && setup.workerOnline;
  const canSpeak = setup.enabled && setup.speech && setup.workerOnline;
  const canImage = setup.enabled && provider !== 'none' && imageConfigured(provider) && setup.workerOnline;
  const checkVoice = job?.voiceId || voice.trim();
  const checkedConnection = connection?.voiceId === checkVoice ? connection : undefined;
  const assetURL = (file: string, download = false) => `/projects/${projectId}/video/assets/${job!.id}/${file}?version=${versionId}${download ? '&download=1' : ''}`;
  const putJob = (value: VideoView) => { refreshEpoch.current++; setJobs(old => [value, ...old.filter(j => j.id !== value.id)]); setSelected(value.id); };
  const refreshing = useRef(false);
  const observedJobs = useRef(new Map(initialJobs.map(j => [j.id, j.status])));
  const observedReleases = useRef(new Map(initialReleases.map(release => [release.id, release.status])));
  const refreshProblem = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current || transferBusyRef.current) return false;
    refreshing.current = true;
    const epoch = refreshEpoch.current;
    try {
      const state = await videoState(projectId, versionId);
      if (epoch !== refreshEpoch.current || transferBusyRef.current) return false;
      if (state.error) {
        setError(state.error);
        if (!refreshProblem.current) toast.error('Не удалось обновить состояние', { id: 'video-connection', description: 'Материалы остаются на экране. Проверим соединение снова.' });
        refreshProblem.current = true; return false;
      }
      if (refreshProblem.current) { toast.success('Соединение восстановлено', { id: 'video-connection' }); setError(''); refreshProblem.current = false; }
      for (const updated of state.jobs!) {
        const previous = observedJobs.current.get(updated.id);
        if ((previous === 'queued' || previous === 'running') && updated.status !== 'queued' && updated.status !== 'running') {
          if (updated.status === 'failed') toast.error('Задача остановлена', { id: `video-job-${updated.id}`, description: updated.message });
          else toast.success(updated.status === 'ready' ? 'Видео собрано' : 'Материалы обновлены', { id: `video-job-${updated.id}`, description: updated.message });
        }
        observedJobs.current.set(updated.id, updated.status);
      }
      for (const release of state.releases!) {
        const previous = observedReleases.current.get(release.id);
        if ((previous === 'queued' || previous === 'running') && (release.status === 'ready' || release.status === 'failed')) {
          if (release.status === 'ready') toast.success('Весь ролик собран', { id: `release-${release.id}` });
          else toast.error('Выпуск не собран', { id: `release-${release.id}`, description: release.message });
        }
        observedReleases.current.set(release.id, release.status);
      }
      setJobs(state.jobs!); setSetup(state.setup!); setParts(state.parts!); setReleases(state.releases!);
      return true;
    } catch {
      if (epoch !== refreshEpoch.current || transferBusyRef.current) return false;
      setError('Не удалось обновить состояние. Проверьте соединение.');
      if (!refreshProblem.current) toast.error('Нет связи', { id: 'video-connection', description: 'Материалы остаются на экране. Проверим соединение снова.' });
      refreshProblem.current = true;
      return false;
    }
    finally { refreshing.current = false; }
  }, [projectId, versionId]);
  const processing = job?.status === 'queued' || job?.status === 'running' || releases.some(release => release.status === 'queued' || release.status === 'running');
  useEffect(() => {
    if (pending || dirty || transferBusy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === 'visible') await refresh();
      if (!cancelled) timer = setTimeout(() => void poll(), processing ? 4000 : 30000);
    };
    timer = setTimeout(() => void poll(), processing ? 4000 : 30000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refresh, processing, pending, dirty, transferBusy]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function assemble(selection: { id: string; revision: number }[]) {
    refreshEpoch.current++;
    startTransition(async () => {
      setError('');
      try {
        const result = await assembleVideoRelease(projectId, versionId, selection);
        if (result.error) setError(result.error);
        else if (result.release) {
          const release = result.release;
          setReleases(old => [release, ...old.filter(item => item.id !== release.id)]);
          observedReleases.current.set(release.id, release.status);
          toast.success(release.status === 'ready' ? 'Этот выпуск уже собран' : 'Выпуск добавлен в очередь');
        }
      } catch { setError('Ответ не получен. Обновите список выпусков перед повтором: сборка могла уже начаться.'); }
      finally { refreshEpoch.current++; }
    });
  }
  function create() {
    if (planSource === 'script' && (chapterPlan.error || !chosenChapter)) { setError(chapterPlan.error || 'Выберите часть сценария.'); return; }
    if (copyingSettings && dirty) { setError('Сначала сохраните описания и общие детали кадров.'); return; }
    if (dirty && !window.confirm('Описания кадров не сохранены. Открыть новую сборку?')) return;
    startTransition(async () => {
      setError('');
      try { const result = await newVideo(projectId, versionId, copyingSettings ? job!.voiceId : voice, copyingSettings ? provider : newImageProvider, planSource, multipart ? chapterIndex : undefined, copyingSettings ? { id: job!.id, revision: job!.revision } : undefined); if (result.error) setError(result.error); else { putJob(result.job!); setDrafts({}); setGuideDraft(undefined); setDraftRevision(undefined); goTo('speech'); toast.success(result.job?.chapter ? `План части ${result.job.chapter.number} создан` : 'План кадров создан'); } }
      catch { setError('Ответ не получен. Обновите состояние и проверьте историю сборок перед повтором: план мог сохраниться.'); }
    });
  }
  function checkConnection() {
    startTransition(async () => {
      setError(''); setConnection(undefined);
      try {
        const result = await checkVideoSpeechConnection(projectId, versionId, checkVoice);
        if (result.error) setError(result.error); else setConnection(result.connection);
      } catch { setError('Проверка подключения не завершена. Генерация не запускалась.'); }
    });
  }
  function save() {
    if (!job) return;
    startTransition(async () => {
      setError('');
      try {
        const result = await saveVideoPrompts(projectId, versionId, job.id, draftRevision ?? job.revision, job.shots.map(s => ({ id: s.id, prompt: drafts[s.id] ?? s.prompt })), guide);
        if (result.error) setError(result.error); else { putJob(result.job!); setDrafts({}); setGuideDraft(undefined); setDraftRevision(undefined); toast.success('Описания и общие детали сохранены'); }
      } catch { setError('Не удалось сохранить описания. Ваши правки остались на экране.'); }
    });
  }
  function checkImages() {
    startTransition(async () => {
      setError(''); setImageConnection(undefined);
      try {
        const result = await checkVideoImageConnection(projectId, versionId, provider);
        if (result.error) setError(result.error); else setImageConnection(result.connection);
      } catch { setError('Проверка выбранного сервиса не завершена. Изображения не создавались.'); }
    });
  }
  function changeImageProvider(value: ImageSelection) {
    setConfirmed(false); setImageConnection(undefined);
    if (!job) { setNewImageProvider(value); return; }
    startTransition(async () => {
      setError('');
      try {
        const result = await saveVideoImageProvider(projectId, versionId, job.id, job.revision, value);
        if (result.error) setError(result.error); else putJob(result.job!);
      } catch { setError('Не удалось сохранить выбор модуля. Обновите состояние. Генерация не запускалась.'); }
    });
  }
  function operate(kind: VideoOperation['kind'], shotId?: string) {
    if (!job || dirty) return;
    if (kind === 'generate' && !job.audio.file) { setError('Сначала создайте озвучку на шаге 02.'); return; }
    const estimate = estimatedCost(job, kind, shotId);
    if (createsMaterials(job, kind) && !confirmed) { setError('Подтвердите запрос в блоке генерации на этом этапе, включая бесплатную квоту.'); return; }
    if (createsMaterials(job, kind) && !window.confirm(`${kind === 'replace' ? 'Создать новое изображение для одного кадра' : kind === 'speech' ? 'Создать только озвучку в ElevenLabs' : 'Создать недостающие материалы'}? Оценка ${usd(estimate)}, предел оценки $${budget}. Изображения: ${providerInfo?.label || 'не выбраны'}. Бесплатная модель использует квоту сервиса; платная — кредиты или деньги. После сетевой ошибки повтор не выполняется. Продолжить?`)) return;
    startTransition(async () => {
      setError('');
      try {
        const result = await startVideoOperation(projectId, versionId, job.id, job.revision, kind, Number(budget), confirmed, shotId);
        if (result.error) { setError(result.error); toast.error('Не удалось запустить задачу', { description: result.error }); }
        else { putJob(result.job!); observedJobs.current.set(result.job!.id, result.job!.status); setConfirmed(false); toast.info('Задача поставлена в очередь'); }
      } catch { setError('Не удалось получить подтверждение запуска. Обновите состояние перед повторным действием.'); }
    });
  }
  function changeAppearance(style: VisualStyle, subtitles: boolean) {
    if (!job || dirty) return;
    startTransition(async () => {
      setError('');
      try {
        const result = await saveVideoAppearance(projectId, versionId, job.id, job.revision, style, subtitles);
        if (result.error) setError(result.error); else { putJob(result.job!); setConfirmed(false); }
      } catch { setError('Не удалось сохранить оформление. Обновите состояние перед повтором.'); }
    });
  }
  function uploadClip(shotId: string, file?: File) {
    if (!job || !file || busy || dirty) return;
    const problem = clipFileProblem(file);
    if (problem) { setError(problem); return; }
    startTransition(async () => {
      setError('');
      try {
        putJob(await uploadVideoClip(projectId, versionId, job, shotId, file)); toast.success('Клип добавлен');
      } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось подтвердить загрузку. Обновите состояние перед повтором.'); }
    });
  }
  function fitClips() {
    if (!job || busy || dirty) return;
    startTransition(async () => {
      setError('');
      try {
        const result = await fitVideoClips(projectId, versionId, job.id, job.revision);
        if (result.error) setError(result.error); else putJob(result.job!);
      } catch { setError('Не удалось подтвердить настройку клипов. Обновите состояние перед повтором.'); }
    });
  }
  function timingLabel(shot: VideoView['shots'][number]) {
    const timing = job?.shotTimings?.[shot.id];
    if (!timing) return 'Длительность появится после озвучки';
    const seconds = timing.end - timing.start;
    const label = `Озвучка ≈ ${seconds.toFixed(1)} с`;
    if (!usesClip(shot)) return label;
    const clip = shot.clip!;
    if (clip.duration >= seconds) return `${label} · клип ${clip.duration.toFixed(1)} с, обрезка по сцене`;
    if (clip.tail === 'hold') return `${label} · клип ${clip.duration.toFixed(1)} с → стоп-кадр ≈ ${(seconds - clip.duration).toFixed(1)} с`;
    if (clip.tail === 'loop') return `${label} · клип ${clip.duration.toFixed(1)} с → обычный повтор`;
    const fit = clipFit(Math.max(1, Math.round(clip.duration * videoFps)), Math.max(1, Math.round(seconds * videoFps)));
    return `${label} · клип ${clip.duration.toFixed(1)} с → ${fit.kind === 'slow' ? 'плавное замедление' : fit.kind === 'smooth' ? 'повтор со сглаженным стыком' : 'повтор'}`;
  }
  function changeVisual(shotId: string, visual: string, tail: string) {
    if (!job || busy || dirty) return;
    startTransition(async () => {
      setError('');
      try {
        const result = await saveVideoVisual(projectId, versionId, job.id, job.revision, shotId, visual, tail);
        if (result.error) setError(result.error); else putJob(result.job!);
      } catch { setError('Не удалось сохранить выбор материала. Обновите состояние.'); }
    });
  }
  const generationConsent = job && ((stage === 'speech' && !job.audio.file) || stage === 'frames') && <details className="video-panel video-generation" open={stage === 'speech' || needs.images || confirmed || undefined}>
      <summary>{stage === 'speech' ? 'Генерация озвучки' : 'Генерация изображений'} · ≈ {usd(cost)} <span>{confirmed ? 'запросы разрешены' : 'разрешение и предел расходов'}</span></summary>
          <div className="video-cost"><span>{stage === 'speech' ? 'Озвучка' : 'Недостающие материалы'}</span><strong>≈ {usd(cost)}</strong><details><summary>Как считается расход</summary><small>Ориентир по API-тарифам на {productionRates.checked}, без налогов, комиссий и возможной надбавки за голос. Подписка и минимальное пополнение оплачиваются отдельно; запрос может расходовать включённые кредиты. Запросов в истории: {job.attempts.length}; сумма их оценок ≈ {usd(job.attempts.reduce((sum, a) => sum + a.estimatedUSD, 0))}. Фактические списания — в кабинетах провайдеров.</small></details></div>
          <label htmlFor="video-budget">Предел оценки следующего запуска, USD</label><input id="video-budget" type="number" min="0" max="10" step="0.01" value={budget} onChange={e => { setBudget(e.target.value); setConfirmed(false); }} disabled={!!busy} />
          <label className="video-consent"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={!!busy} />Разрешаю указанные запросы к выбранному сервису, включая бесплатную квоту. Для платного API действует предел оценки; списание при ошибке возможно.</label>
    </details>;
  return <section className="video-studio" aria-label="Производство видео">
    <div className="video-studio-heading"><h2>Видеостудия</h2><span className="video-pill">MP4 · 720p · 16:9</span></div>
    {error && <p className="video-alert" role="alert">{error}</p>}
    <div className="video-toolbar">
      <p>{job ? `${statusLabel[job.status]} · ${job.shots.filter(hasVisual).length}/${job.shots.length} кадров` : 'Начните с бесплатного плана кадров'} · {setup.workerOnline ? 'Обработчик работает' : 'Обработчик не запущен'}</p>
      <button type="button" className="video-text-button" aria-expanded={showConnections} aria-controls="video-connections" onClick={() => setShowConnections(value => !value)}>Настройки сервисов{!canGenerate ? ' · требуют внимания' : ''}</button>
    </div>
    <div id="video-connections" hidden={!showConnections}>
    <details className="video-connection" open>
      <summary>Подключение <span>{canGenerate ? 'готово к запуску' : 'нужно настроить'}</span></summary>
      <p>ElevenLabs: {setup.speech ? 'ключ задан' : 'ключ не задан'} · изображения: {providerInfo?.label || 'модуль не выбран'} · обработчик: {setup.workerOnline ? 'работает' : 'не запущен'}. Наличие ключа не подтверждает доступ и баланс.</p>
      <p>Для первой озвучки добавьте <code>ELEVENLABS_API_KEY</code> в <code>.env.local</code> и перезапустите приложение. Проверка ниже работает при выключенной генерации. Для создания озвучки включите <code>VIDEO_GENERATION_ENABLED=true</code> и запустите <code>npm run video:worker</code> в отдельном терминале. Модуль изображений выбирается отдельно ниже.</p>
      <p>ElevenLabs ограничивает доступ из России. Проверьте доступность API до оплаты. До подключения можно бесплатно подготовить план кадров.</p>
      <button type="button" className="button secondary" disabled={!!busy || !setup.speech || !checkVoice} onClick={checkConnection}>Проверить ElevenLabs · без генерации</button>
      <p className="video-muted">Проверяется {job ? 'сохранённый голос этой сборки' : 'Voice ID из поля ниже'}: {checkVoice || 'не указан'}. Разрешения ключа: User — Read, Voices — Read; для озвучки также Text to Speech — Access.</p>
      {checkedConnection && <div role="status"><p>API ответил · голос: <strong>{checkedConnection.voiceName}</strong> · тариф: {checkedConnection.tier}. Остаток квоты по данным API: {checkedConnection.remainingCharacters.toLocaleString('ru-RU')}. Проверено: {new Date(checkedConnection.checkedAt).toLocaleTimeString('ru-RU')}.</p><p className="video-muted">Это проверка сведений о подписке и голосе. Она не подтверждает разрешение генерации, качество озвучки или лимит конкретного ключа. Права на публикацию и расход проверяйте в кабинете ElevenLabs.</p></div>}
      {checkedConnection?.tier === 'free' && <p role="note">На Free голоса из Voice Library недоступны через API, даже если на сайте они работают и кредиты остались. Для теста выберите голос с доступом к API на вашем тарифе; добавление в My Voices само по себе ограничение не снимает. <a href="https://elevenlabs.io/docs/eleven-creative/voices/voice-library" target="_blank" rel="noreferrer">Условия ElevenLabs</a></p>}
      {checkedConnection && job && <p className="video-muted">Текст этой сборки: {job.text.length.toLocaleString('ru-RU')} символов. Остаток квоты не учитывает возможную надбавку за голос и отдельный лимит API-ключа.</p>}
      <label htmlFor="video-image-provider">Модуль изображений</label>
      <select id="video-image-provider" value={provider} disabled={!!busy || dirty} onChange={e => changeImageProvider(e.target.value as ImageSelection)}>
        <option value="none">Выберите сервис — без автоматического выбора</option>
        {Object.entries(imageCatalog).map(([id, info]) => <option key={id} value={id}>{info.label} · {imageBillingLabel(id as ImageProviderId)}</option>)}
      </select>
      <p className="video-muted">Выбор меняет только будущие запросы. Озвучка и готовые кадры сохраняются. Незавершённые задачи проверяются у исходного сервиса. Для Runway ниже есть отдельное подключение аккаунта подписки. Автоматическая видеоанимация пока не включена.</p>
      {providerInfo && <><p>{providerInfo.terms} <a href={providerInfo.url} target="_blank" rel="noreferrer">Условия сервиса</a></p>
        <p className="video-muted">В .env.local: {providerInfo.setup}. После изменения ключей перезапустите приложение и обработчик. {provider === 'cloudflare-sdxl' ? 'Cloudflare → Workers AI → Use REST API: создайте токен Workers AI Read/Edit и скопируйте Account ID. Пополнять BFL не требуется.' : provider === 'google-nano-banana-21' ? 'Нужен ключ Google AI Studio и отдельный платёжный аккаунт Gemini API.' : 'Нужен собственный API-ключ и баланс BFL.'}</p>
        <button type="button" className="button secondary" disabled={!!busy || provider === 'none' || !imageConfigured(provider)} onClick={checkImages}>Проверить {providerInfo.label} · без генерации</button>
        {provider !== 'none' && !imageConfigured(provider) && <p className="video-muted">Настройки выбранного модуля ещё не заданы или Account ID некорректен.</p>}
      </>}
      {checkedImage && <div role="status"><p>{checkedImage.message}{checkedImage.credits !== undefined && <> Баланс: <strong>{checkedImage.credits.toLocaleString('ru-RU')} кредитов</strong>.</>} Проверено: {new Date(checkedImage.checkedAt).toLocaleTimeString('ru-RU')}.</p></div>}
    </details>
    <details className="video-connection"><summary>Google Flow · уже имеющаяся Google Pro</summary>
      <p>Создайте анимацию на сайте Flow, затем добавьте скачанный MP4 к нужной сцене. У готовых изображений ниже есть кнопки скачивания кадра и копирования промпта движения. Монтаж выполняется в ScenePilot с сохранённой озвучкой.</p>
      <p>Генерация в Flow расходует квоту Google. Открытие сайта и копирование материалов здесь ничего не генерируют. Это ручной перенос клипа: подписка Google Pro не подключает платный Gemini API к ScenePilot.</p>
      <a className="button secondary" href="https://labs.google/fx/tools/flow" target="_blank" rel="noreferrer">Открыть Google Flow</a>
    </details>
    <RunwayConnection projectId={projectId} versionId={versionId} disabled={!!busy || dirty} />
    </div>
    <nav className="video-steps" aria-label="Этапы сборки">
      {videoStages.map(([id, number, label]) => <button key={id} type="button" disabled={transferBusy || (!job && id !== 'plan')} aria-current={stage === id ? 'step' : undefined} aria-controls={`video-stage-${id}`} onClick={() => goTo(id)}><span>{number}</span><div>{label}<small>{progress[id]}</small></div></button>)}
    </nav>
    {jobs.length > 0 && <details className="video-history"><summary>Сборки этой версии · {jobs.length}</summary>
        {jobs.length > 0 && <><label htmlFor="video-history">Сборки этой версии</label><select id="video-history" value={selected} disabled={!!busy} onChange={e => {
          if (dirty && !window.confirm('Описания не сохранены. Переключить сборку?')) return;
          setSelected(e.target.value); setDrafts({}); setGuideDraft(undefined); setDraftRevision(undefined); setConfirmed(false); setStage(suggestedVideoStage(jobs.find(j => j.id === e.target.value)));
        }}>{jobs.map((j, i) => <option key={j.id} value={j.id}>{j.chapter ? `Часть ${j.chapter.number}/${j.chapter.total} · ` : ''}{new Date(j.createdAt).toLocaleString('ru-RU')} · {statusLabel[j.status]} {i === 0 ? '· последняя' : ''}</option>)}</select></>}
    </details>}
    {job && <div className="video-status" role="status"><strong>{statusLabel[job.status]}</strong><p>{job.message}</p><button type="button" className="video-text-button" disabled={pending} onClick={() => void refresh()}>Обновить состояние</button></div>}
    {job?.chapter && <p className="video-part-notice"><strong>Часть {job.chapter.number} из {job.chapter.total}.</strong> Здесь материалы выбранной части. Готовые части объединяются в весь ролик на этапе «Сборка».</p>}
    {job && !setup.workerOnline && <p className="video-muted">Обработчик не запущен. Для генерации и монтажа запустите <code>npm run video:worker</code> в отдельном терминале. Если он закрывается — <code>npm run video:doctor</code>.</p>}
    {job && (stage === 'speech' || stage === 'frames') && (!setup.enabled || (stage === 'speech' ? !setup.speech : provider !== 'none' && !imageConfigured(provider))) && <p className="video-muted">Для запуска нужно настроить сервис. <button type="button" className="video-text-button" onClick={() => setShowConnections(true)}>Открыть настройки</button></p>}
    {dirty && <div className="video-draft-bar" role="status"><span>Есть несохранённые описания или общие детали кадров.</span><button type="button" className="video-text-button" onClick={save} disabled={!!busy}>Сохранить описания</button></div>}
    <div className="video-studio-grid">
      <section id="video-stage-plan" aria-label="Сценарий" hidden={stage !== 'plan'} className="video-panel video-brief">
        <p className="eyebrow">01 / СЦЕНАРИЙ</p><h3>Основа ролика</h3>
        <p className="video-script">{job?.text || script}</p>
        <p className="video-muted">{(job?.text || script).length} символов · {job?.planSource === 'scenes' ? 'озвучка сохранённых сцен' : 'сохранённый сценарий'}<br />Источник: {({ manual: 'ручной ввод', test: 'тестовый шаблон', yandex: 'YandexGPT', mixed: 'смешанные источники сцен' } as Record<string, string>)[job?.source || scriptSource] || 'не указан'}</p>
        {job && <button type="button" className="button" onClick={() => goTo('speech')}>К озвучке →</button>}
        <details open={!job || undefined} className="video-new-plan"><summary>{job ? 'Другая основа или голос · новая сборка' : 'Настройки плана'}</summary>
        <label htmlFor="video-plan-source">Основа новой сборки</label><select id="video-plan-source" value={planSource} disabled={!!busy} onChange={e => setPlanSource(e.target.value as 'script' | 'scenes')}><option value="script">Сохранённый сценарий</option><option value="scenes">Сохранённые сцены: их озвучка и промпты</option></select>
        <p className="video-muted">{planSource === 'scenes' ? 'Одна сохранённая сцена — один кадр с её полным текстом и промптом. 12 сцен дадут 12 кадров. Длинный кадр можно оживить локальным движением картинки или автоподгонкой клипа. Это не создаёт новых действий персонажа.' : 'Текст делится примерно по 8 секунд с учётом темпа чтения. Это черновые места для изображений, а не продуманная режиссура. Если сцены уже готовы, выберите их источником, чтобы сохранить ваши визуальные описания.'} Дополнительное дробление доступно отдельно после озвучки. Старые сборки не изменяются; новая сборка не переносит их материалы.</p>
        {multipart && <div className="video-chapters">
          <h4>Части длинного сценария</h4><p>Получилось частей: {chapterPlan.chapters.length}. Это разбиение по объёму и границам предложений, не редактура сюжета. Исходная версия остаётся целой.</p>
          <label htmlFor="video-chapter">Какую часть подготовить</label><select id="video-chapter" value={chapterIndex} disabled={!!busy} onChange={event => setChapterIndex(Number(event.target.value))}>{chapterPlan.chapters.map((part, index) => <option key={part.number} value={index}>Часть {part.number} · ≈ {formatDuration(part.estimatedSeconds)} · {part.text.length} символов</option>)}</select>
          {chosenChapter && <><p className="video-muted">{chosenChapter.words} слов · длительность оценена при {planningPace} слов/мин. Точное время появится после озвучки.</p><details><summary>Текст выбранной части</summary><p className="video-script">{chosenChapter.text}</p></details></>}
          <p className="video-muted">Создаётся только выбранная часть. У каждой будет своя озвучка, кадры и MP4; готовые части можно объединить на этапе «Сборка». Сохранённые сцены и материалы других сборок сюда не переносятся.</p>
        </div>}
        {job && <VideoSettingsTransfer job={job} checked={inheritSettings} disabled={!!busy} dirty={dirty} onChange={setInheritSettings} />}
        {!copyingSettings && <>
          <label htmlFor="video-voice">Voice ID ElevenLabs</label><input id="video-voice" value={voice} onChange={e => setVoice(e.target.value)} maxLength={100} disabled={!!busy} />
          <p className="video-muted">Для новой сборки. В ElevenLabs: My Voices → меню голоса → Copy voice ID.</p>
          <label htmlFor="video-new-image-provider">Изображения новой сборки</label><select id="video-new-image-provider" value={newImageProvider} disabled={!!busy} onChange={event => setNewImageProvider(event.target.value as ImageSelection)}>
            <option value="none">Ручной перенос из Flow или другого сервиса</option>
            {Object.entries(imageCatalog).map(([id, info]) => <option key={id} value={id}>{info.label}</option>)}
          </select>
          <p className="video-muted">Стиль и общие детали можно задать на этапе «Кадры», субтитры — на этапе «Сборка». Выбор сервиса не запускает генерацию.</p>
        </>}
        <button type="button" className="button" disabled={!!busy || (copyingSettings ? dirty : !voice.trim()) || (planSource === 'script' && (!!chapterPlan.error || !chosenChapter))} onClick={create}>{multipart ? `Подготовить часть ${chapterIndex + 1} из ${chapterPlan.chapters.length}` : job ? 'Создать отдельную сборку' : 'Подготовить план и перейти к озвучке'} <span aria-hidden="true">→</span></button>
        {planSource === 'script' && chapterPlan.error && <p role="alert">{chapterPlan.error}</p>}
        <p className="video-muted">Подготовка плана бесплатна. Голос и изображения создаются на следующих этапах после вашего подтверждения.</p>
        </details>
      </section>
      {stage === 'speech' && <section id="video-stage-speech" aria-label="Озвучка" className="video-panel video-result">
        <p className="eyebrow">02 / ОЗВУЧКА</p><h3>Сначала голос и ритм</h3>
        {job && <>
          <p>{job.text.length.toLocaleString('ru-RU')} символов · ElevenLabs · Multilingual v2</p>
          {generationConsent}
          <button type="button" className="video-text-button" disabled={!!busy || !setup.speech} onClick={checkConnection}>Проверить голос · без генерации</button>
          {checkedConnection && <p role="status">{checkedConnection.voiceName} · {checkedConnection.tier} · остаток квоты: {checkedConnection.remainingCharacters.toLocaleString('ru-RU')}. Проверка не гарантирует разрешение генерации.</p>}
          {checkedConnection?.tier === 'free' && <p className="video-muted">На Free голоса из Voice Library недоступны через API даже при остатке кредитов. Выберите доступный голос либо проверьте условия тарифа.</p>}
          {job.audio.file ? <><div className="video-audio"><audio controls preload="metadata" src={assetURL(job.audio.file)} aria-label="Озвучка ролика" /><a className="video-text-button" href={assetURL(job.audio.file, true)}>Скачать MP3</a></div><p>Прослушайте голос. По его таймингам будут рассчитаны длительности кадров.</p><button type="button" className="button" onClick={() => goTo('frames')}>К кадрам →</button></> : <><button type="button" className="button" disabled={!!busy || dirty || !canSpeak || !confirmed || job.audio.state === 'unknown'} onClick={() => operate('speech')}>Создать озвучку · ≈ {usd(estimatedCost(job, 'speech'))}</button><p className="video-muted">Один запрос озвучки. Изображения на этом этапе не создаются.</p>{job.audio.state === 'unknown' && <p className="video-alert">Результат прошлой озвучки неизвестен. Проверьте историю ElevenLabs перед новым запросом.</p>}</>}
          <button type="button" className="video-text-button" onClick={() => goTo('plan')}>← Сценарий и выбор голоса</button>
        </>}
      </section>}
      {stage === 'frames' && <section id="video-stage-frames" aria-label="Кадры" className="video-panel video-frames">
        <p className="eyebrow">03 / КАДРЫ</p><h3>Создайте визуальный ряд</h3>
        {job && <>
          <p>Готово материалов: {job.shots.filter(hasVisual).length} из {job.shots.length}. Проверьте описания перед генерацией.</p>
          <label htmlFor="video-frames-provider">Сервис изображений</label>
          <select id="video-frames-provider" value={provider} disabled={!!busy || dirty} onChange={e => changeImageProvider(e.target.value as ImageSelection)}><option value="none">Без API · загрузка готовых кадров</option>{Object.entries(imageCatalog).map(([id, info]) => <option key={id} value={id}>{info.label} · {imageBillingLabel(id as ImageProviderId)}</option>)}</select>
          {provider === 'cloudflare-flux2-klein9b' && <p className="video-muted">Подойдут уже настроенные ключи Cloudflare. {imageCatalog[provider].terms} Сначала сравните один кадр с SDXL; автоматического перехода на другую модель нет.</p>}
          <label htmlFor="video-visual-style">Общий стиль</label>
          <select id="video-visual-style" value={job.visualStyle ?? 'original'} disabled={!!busy || dirty} onChange={e => changeAppearance(e.target.value as VisualStyle, job.subtitlesEnabled ?? true)}>{Object.entries(visualStyles).map(([id, style]) => <option key={id} value={id}>{style.label}</option>)}</select>
          <p className="video-muted">Стиль применяется к новым изображениям. Готовые материалы сохраняются; одинаковые лица не гарантируются.</p>
          <FrameVisualGuide value={guide} disabled={!!busy} dirty={dirty} onSave={save} onChange={value => { if (!dirty) setDraftRevision(job.revision); setGuideDraft(value); setConfirmed(false); }} promptLengths={job.shots.map(shot => imagePrompt(drafts[shot.id] ?? shot.prompt, job.visualStyle, guide).length)} />
          {!job.audio.file && <p>Сначала <button type="button" className="video-text-button" onClick={() => goTo('speech')}>создайте озвучку</button>, чтобы получить длительности кадров.</p>}
          {generationConsent}
          {needs.images && <button type="button" className="button" disabled={!!busy || dirty || !job.audio.file || !canGenerate || (createsMaterials(job, 'generate') && !confirmed)} onClick={() => operate('generate')}>Создать недостающие изображения · ≈ {usd(cost)}</button>}
          {needs.images && <p className="video-muted">Сохранённый голос и готовые изображения используются повторно. Для пробы можно создать один кадр ниже.</p>}
          {provider === 'none' && <p className="video-muted">Добавьте изображения из Flow ниже или выберите сервис для генерации по API.</p>}
          {job.shots.some(s => s.image.state === 'pending') && <button type="button" className="button secondary" disabled={!!busy || dirty || !setup.workerOnline || !neededImageProviders(job, 'check').every(imageConfigured)} onClick={() => operate('check')}>Проверить задачи изображений · без новой генерации</button>}
          <div className="video-step-actions"><button type="button" className="video-text-button" onClick={() => goTo('speech')}>← Озвучка</button><button type="button" className={visualsReady ? 'button' : 'button secondary'} onClick={() => goTo('motion')}>{visualsReady ? 'К анимации →' : 'Добавить готовые клипы →'}</button></div>
          <TimedStoryboard key={`${job.id}-${job.revision}`} job={job} projectId={projectId} versionId={versionId} disabled={!!busy || dirty} onBusy={setStoryboardBusy} onCreated={value => { putJob(value); setConfirmed(false); }} />
          <FrameImageImport key={job.id} job={job} projectId={projectId} versionId={versionId} disabled={!!busy || dirty} onBusy={markTransferBusy} onJob={putJob} onRefresh={refresh} />
        </>}
        {job && <ol className="video-shot-list">{job.shots.map((shot, index) => <li className="video-shot" key={shot.id}>
          <div className="video-shot-image">{shot.image.file ? <Image unoptimized width={1280} height={720} src={assetURL(shot.image.file)} alt={`Изображение кадра ${index + 1}`} /> : usesClip(shot) ? <video style={{ width: '100%', height: '100%', objectFit: 'contain' }} controls muted preload="metadata" src={assetURL(shot.clip!.file)} aria-label={`Клип сцены ${index + 1}`} /> : <span>КАДР {String(index + 1).padStart(2, '0')}<small>{shot.image.state === 'pending' ? 'Обрабатывается сервисом' : shot.image.state === 'unknown' ? 'Результат запроса неизвестен' : 'Изображение ещё не создано'}</small></span>}</div>
          <div className="video-shot-copy"><p className="video-shot-label">Кадр {index + 1} · {shot.image.file || !usesClip(shot) ? 'Изображение' : 'MP4-клип'}</p><p>{shot.text}</p><p className="video-muted">{timingLabel(shot)}</p><details><summary>Описание изображения</summary><label className="sr-only" htmlFor={`prompt-${shot.id}`}>Описание кадра {index + 1}</label><textarea id={`prompt-${shot.id}`} rows={4} maxLength={productionLimits.prompt} value={drafts[shot.id] ?? shot.prompt} disabled={!!busy} onChange={e => { if (!dirty) setDraftRevision(job.revision); setDrafts(old => ({ ...old, [shot.id]: e.target.value })); }} /></details>
            <details><summary>Итоговый промпт</summary><p className="video-muted video-prompt-preview">{imagePrompt(drafts[shot.id] ?? shot.prompt, job.visualStyle, guide)}</p>{dirty && <small className="video-muted">Показан черновик. Сохраните описания перед генерацией по API.</small>}</details>
            {shot.image.file && <small className="video-muted">Источник изображения: {shot.image.source === 'upload' ? 'загруженный файл · модель не подтверждена' : imageCatalog[shot.image.provider || 'bfl-flux11'].label}{shot.image.source !== 'upload' && shot.image.generatedPrompt !== imagePrompt(shot.prompt, job.visualStyle, job.visualGuide) ? ' · описание, стиль или общие детали изменены после генерации' : ''}{usesClip(shot) ? ' · в монтаже выбран MP4-клип' : ''}</small>}
            <div className="video-frame-actions" role="group" aria-label={`Действия кадра ${index + 1}`}>
              <button type="button" className="video-text-button" disabled={!!busy} onClick={async () => { try { await navigator.clipboard.writeText(framePromptForFlow({ ...job, visualGuide: guide }, drafts[shot.id] ?? shot.prompt)); toast.success(dirty ? 'Промпт скопирован из черновика' : 'Промпт изображения скопирован', { description: 'Вставьте его в Flow в режиме «Изображение». Для согласованности добавьте референс.' }); } catch { toast.error('Не удалось скопировать', { description: 'Раскройте итоговый промпт и скопируйте текст вручную.' }); } }}>Скопировать промпт для Flow</button>
              <button type="button" className="video-text-button" disabled={!!busy || dirty || !canImage || ['pending', 'requesting'].includes(shot.image.state)} onClick={() => operate('replace', shot.id)}>{shot.image.file || shot.image.state === 'unknown' || shot.image.state === 'failed' ? 'Новое изображение' : 'Создать этот кадр'} · ≈ {usd(imagePrice(job))}</button>
            </div>
            <FrameImageInput key={`${job.id}-${shot.id}`} job={job} shotId={shot.id} number={index + 1} projectId={projectId} versionId={versionId} disabled={!!busy || dirty} onBusy={markTransferBusy} onJob={putJob} onRefresh={refresh} />
            {shot.image.state === 'unknown' && <small className="video-muted">Результат прошлого запроса неизвестен. Новое изображение — отдельный запрос с расходом квоты или денег; сначала проверьте историю исходного сервиса.</small>}
          </div>
        </li>)}</ol>}
      </section>}
      {stage === 'motion' && <section id="video-stage-motion" aria-label="Анимация" className="video-panel video-frames">
        <p className="eyebrow">04 / АНИМАЦИЯ</p><h3>Добавьте движение</h3>
        <p>Этот этап можно пропустить: изображения получат плавное движение при монтаже. Для анимации персонажей создайте клипы в Flow и добавьте их к кадрам.</p>
        <p className="video-muted">Flow пока используется вручную и расходует квоту Google. Автоподгонка длительности не создаёт новых действий персонажа.</p>
        {job && <>
          <FlowBatch key={job.id} job={job} projectId={projectId} versionId={versionId} disabled={!!busy || dirty} onBusy={markTransferBusy} onJob={putJob} onRefresh={refresh} />
          <div className="video-step-actions"><button type="button" className="video-text-button" disabled={transferBusy} onClick={() => goTo('frames')}>← Кадры</button><button type="button" className="button" disabled={transferBusy || !job.audio.file || !visualsReady || dirty} onClick={() => goTo('result')}>{job.shots.some(usesClip) ? 'К сборке →' : 'Продолжить без клипов →'}</button></div>
          {(!job.audio.file || !visualsReady) && <p className="video-muted">Для сборки нужны озвучка и изображение или клип в каждом кадре.</p>}
          {job.shots.some(shot => shot.clip) && <button type="button" className="video-text-button" disabled={!!busy || dirty} onClick={fitClips}>Автоподгонка всех клипов под озвучку</button>}
          <ol className="video-shot-list">{job.shots.map((shot, index) => <li className="video-shot" key={shot.id}>
          <div className="video-shot-image">{usesClip(shot) ? <video style={{ width: '100%', height: '100%', objectFit: 'contain' }} controls muted preload="metadata" src={assetURL(shot.clip!.file)} aria-label={`Клип сцены ${index + 1}`} /> : shot.image.file ? <Image unoptimized width={1280} height={720} src={assetURL(shot.image.file)} alt={`Изображение кадра ${index + 1}`} /> : <span>КАДР {String(index + 1).padStart(2, '0')}<small>{shot.image.state === 'pending' ? 'Обрабатывается сервисом' : shot.image.state === 'unknown' ? 'Результат запроса неизвестен' : 'Изображение ещё не создано'}</small></span>}</div>
          <div className="video-shot-copy"><p className="video-shot-label">Кадр {index + 1} · {usesClip(shot) ? 'MP4-клип' : 'Изображение'}</p><p>{shot.text}</p><p className="video-muted">{timingLabel(shot)}</p>
            {shot.image.file && <FlowHandoff key={`${job.id}-${shot.id}`} sceneNumber={index + 1} imageURL={assetURL(shot.image.file, true)} description={shot.prompt} disabled={!!busy || dirty} hasClip={!!shot.clip} onImport={file => uploadClip(shot.id, file)} />}
            <details><summary>{shot.clip ? 'Клип и монтаж сцены' : 'Добавить MP4-клип'}</summary>
              <p className="video-muted">Готовое видео из Runway, Veo или другого источника. До 32 МиБ, 60 секунд и 4096 × 4096. Файл копируется на компьютер; загрузка не вызывает генерацию.</p>
              <label htmlFor={`clip-${shot.id}`}>{shot.clip ? 'Заменить клип' : 'Выбрать MP4'}</label>
              <input id={`clip-${shot.id}`} type="file" accept="video/mp4,.mp4" disabled={!!busy || dirty} onChange={e => { uploadClip(shot.id, e.target.files?.[0]); e.target.value = ''; }} />
              {shot.clip && <>
                <p className="video-muted">Источник: загруженный MP4 · {shot.clip.duration.toFixed(1)} с. Звук клипа исключается, остаётся озвучка. Края обрезаются до 16:9; длинный клип обрезается по сцене.</p>
                <label htmlFor={`visual-${shot.id}`}>Материал в сборке</label>
                <select id={`visual-${shot.id}`} value={shot.visual ?? 'image'} disabled={!!busy || dirty} onChange={e => changeVisual(shot.id, e.target.value, shot.clip!.tail)}><option value="image">Изображение</option><option value="clip">MP4-клип</option></select>
                <label htmlFor={`tail-${shot.id}`}>Если клип короче сцены</label>
                <select id={`tail-${shot.id}`} value={shot.clip.tail} disabled={!!busy || dirty} onChange={e => changeVisual(shot.id, shot.visual ?? 'image', e.target.value)}><option value="auto">Авто: замедление / плавный повтор</option><option value="hold">Задержать последний кадр</option><option value="loop">Повторять клип</option></select>
                <a className="video-text-button" href={assetURL(shot.clip.file, true)}>Скачать исходный клип</a>
              </>}
            </details>
          </div></li>)}</ol>
        </>}
      </section>}
      {stage === 'result' && <section id="video-stage-result" aria-label="Сборка" className="video-panel video-result">
        <p className="eyebrow">05 / СБОРКА</p><h3>{job?.chapter ? `MP4 части ${job.chapter.number}` : 'Проверьте и сохраните ролик'}</h3>
        <div className="video-preview">{job?.output ? <video key={job.output} controls preload="metadata" src={assetURL(job.output)} aria-label="Собранное видео" /> : <div><span aria-hidden="true">▷</span><p>Здесь будет ваш ролик</p><small>Изображения с движением, голос и субтитры</small></div>}</div>
        {job && <>
          <p className="video-muted">Озвучка: {job.audio.file ? 'сохранена' : 'ещё не готова'} · сцены с материалом: {job.shots.filter(hasVisual).length} из {job.shots.length} сохранено.</p>
          {job.outputStale && <p className="video-alert">Материалы или оформление изменены. В проигрывателе предыдущая сборка; соберите видео заново.</p>}
          <label className="video-consent"><input id="video-subtitles" type="checkbox" checked={job.subtitlesEnabled ?? true} disabled={!!busy || dirty} onChange={e => changeAppearance(job.visualStyle ?? 'original', e.target.checked)} />Субтитры в готовом видео</label>
          <p className="video-muted">Выбор сохраняется сразу. Изменится следующий MP4 после пересборки; озвучка и изображения используются повторно.</p>
          <button type="button" className="button" disabled={!!busy || dirty || !setup.workerOnline || !job.audio.file || job.shots.some(s => !hasVisual(s))} onClick={() => operate('render')}>{job.chapter ? 'Собрать MP4 этой части' : 'Собрать MP4 на компьютере'}</button>
          <p className="video-muted">{!job.audio.file || job.shots.some(s => !hasVisual(s)) ? 'Для MP4 нужны озвучка и изображение или клип в каждой сцене.' : 'Материалы сохранены — можно собрать MP4.'} Монтаж выполняется локально, без новых запросов генерации.</p>
          {job.output && <a className="button secondary" href={assetURL(job.output, true)}>{job.chapter ? 'Скачать MP4 части' : 'Скачать MP4'}</a>}
          <div className="video-step-actions"><button type="button" className="video-text-button" onClick={() => goTo('motion')}>← Анимация</button>
          {!job.audio.file && <button type="button" className="video-text-button" onClick={() => goTo('speech')}>Создать озвучку</button>}
          {!visualsReady && <button type="button" className="video-text-button" onClick={() => goTo('frames')}>Дополнить кадры</button>}</div>
        </>}
        {!job && <p>Сначала подготовьте план на шаге «Сценарий».</p>}
        <VideoReleasePanel projectId={projectId} versionId={versionId} parts={parts} releases={releases} disabled={!!busy || dirty} workerOnline={setup.workerOnline} onAssemble={assemble} onRefresh={() => void refresh()} />
      </section>}
    </div>
  </section>;
}
