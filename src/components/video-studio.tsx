'use client';
import { useCallback, useEffect, useState, useTransition } from 'react';
import Image from 'next/image';
import { type VideoView, type VideoSetup, type VideoOperation, type SpeechConnection, estimatedCost, requiredProviders, productionRates, productionLimits, normalizeNarration } from '@/lib/production/model';
import { newVideo, saveVideoPrompts, startVideoOperation, videoState, checkVideoSpeechConnection } from '@/app/projects/[id]/video/actions';

const statusLabel: Record<VideoView['status'], string> = { draft: 'План кадров', queued: 'В очереди', running: 'В работе', materials: 'Материалы готовы', ready: 'Видео готово', failed: 'Нужно внимание' };
const usd = (value: number) => '$' + value.toFixed(3).replace(/0$/, '');
export function VideoStudio({ projectId, versionId, script, scriptSource = 'unknown', initialJobs, initialSetup, defaultVoice }: {
  projectId: string; versionId: string; script: string; scriptSource?: string; initialJobs: VideoView[]; initialSetup: VideoSetup; defaultVoice: string;
}) {
  const [jobs, setJobs] = useState(initialJobs), [selected, setSelected] = useState(initialJobs[0]?.id || '');
  const [setup, setSetup] = useState(initialSetup), [voice, setVoice] = useState(defaultVoice);
  const [error, setError] = useState(''), [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({}), [draftRevision, setDraftRevision] = useState<number>();
  const [budget, setBudget] = useState('1.00'), [confirmed, setConfirmed] = useState(false);
  const [connection, setConnection] = useState<SpeechConnection>();
  const job = jobs.find(j => j.id === selected);
  const dirty = Object.keys(drafts).length > 0;
  const busy = pending || job?.status === 'queued' || job?.status === 'running';
  const cost = job ? estimatedCost(job, 'generate') : 0;
  const needs = job ? requiredProviders(job, 'generate') : { speech: true, images: true };
  const canGenerate = setup.enabled && (!needs.speech || setup.speech) && (!needs.images || setup.images) && setup.workerOnline;
  const canSpeak = setup.enabled && setup.speech && setup.workerOnline;
  const canImage = setup.enabled && setup.images && setup.workerOnline;
  const checkVoice = job?.voiceId || voice.trim();
  const checkedConnection = connection?.voiceId === checkVoice ? connection : undefined;
  const assetURL = (file: string, download = false) => `/projects/${projectId}/video/assets/${job!.id}/${file}?version=${versionId}${download ? '&download=1' : ''}`;
  const putJob = (value: VideoView) => { setJobs(old => [value, ...old.filter(j => j.id !== value.id)]); setSelected(value.id); };
  const refresh = useCallback(async () => {
    try {
      const state = await videoState(projectId, versionId);
      if (state.error) { setError(state.error); return; }
      setJobs(state.jobs!); setSetup(state.setup!);
    } catch { setError('Не удалось обновить состояние. Проверьте соединение.'); }
  }, [projectId, versionId]);
  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(() => { if (!cancelled && document.visibilityState === 'visible') void refresh(); }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function create() {
    if (dirty && !window.confirm('Описания кадров не сохранены. Открыть новую сборку?')) return;
    startTransition(async () => {
      setError('');
      try { const result = await newVideo(projectId, versionId, voice); if (result.error) setError(result.error); else { putJob(result.job!); setDrafts({}); setDraftRevision(undefined); } }
      catch { setError('Не удалось создать план. Попробуйте позже.'); }
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
        const result = await saveVideoPrompts(projectId, versionId, job.id, draftRevision ?? job.revision, job.shots.map(s => ({ id: s.id, prompt: drafts[s.id] ?? s.prompt })));
        if (result.error) setError(result.error); else { putJob(result.job!); setDrafts({}); setDraftRevision(undefined); }
      } catch { setError('Не удалось сохранить описания. Ваши правки остались на экране.'); }
    });
  }
  function operate(kind: VideoOperation['kind'], shotId?: string) {
    if (!job || dirty) return;
    const estimate = estimatedCost(job, kind, shotId);
    if (estimate > 0 && !confirmed) { setError('Подтвердите платную генерацию под оценкой расходов.'); return; }
    if (estimate > 0 && !window.confirm(`${kind === 'replace' ? 'Создать новое изображение для одного кадра' : kind === 'speech' ? 'Создать только озвучку в ElevenLabs' : 'Создать недостающие материалы'}? Оценка ${usd(estimate)}, предел оценки $${budget}. Расходуются кредиты или деньги провайдера. После сетевой ошибки списание возможно. Продолжить?`)) return;
    startTransition(async () => {
      setError('');
      try {
        const result = await startVideoOperation(projectId, versionId, job.id, job.revision, kind, Number(budget), confirmed, shotId);
        if (result.error) setError(result.error); else { putJob(result.job!); setConfirmed(false); }
      } catch { setError('Не удалось получить подтверждение запуска. Обновите состояние перед повторным действием.'); }
    });
  }
  return <section className="video-studio" aria-label="Производство видео">
    <div className="video-studio-heading"><div><p className="eyebrow">ОТ СЦЕНАРИЯ К РОЛИКУ</p><h2>Соберите свою историю</h2><p>Озвучка, кадры и субтитры — в одном видео.</p></div><span className="video-pill">MP4 · 720p · 16:9</span></div>
    {error && <p className="video-alert" role="alert">{error}</p>}
    <details className="video-connection" open={!setup.enabled || !setup.speech || !setup.images || !setup.workerOnline}>
      <summary>Подключение <span>{canGenerate ? 'готово к запуску' : 'нужно настроить'}</span></summary>
      <p>ElevenLabs: {setup.speech ? 'ключ задан' : 'ключ не задан'} · FLUX: {setup.images ? 'ключ задан' : 'ключ не задан'} · обработчик: {setup.workerOnline ? 'работает' : 'не запущен'}. Наличие ключа не подтверждает доступ и баланс.</p>
      <p>Для первой озвучки добавьте <code>ELEVENLABS_API_KEY</code> в <code>.env.local</code> и перезапустите приложение. Проверка ниже работает при выключенной генерации. Для создания озвучки включите <code>VIDEO_GENERATION_ENABLED=true</code> и запустите <code>npm run video:worker</code> в отдельном терминале. Изображения подключаются отдельно через <code>BFL_API_KEY</code>.</p>
      <p>ElevenLabs ограничивает доступ из России. Проверьте доступность API до оплаты. До подключения можно бесплатно подготовить план кадров.</p>
      <button type="button" className="button secondary" disabled={!!busy || !setup.speech || !checkVoice} onClick={checkConnection}>Проверить ElevenLabs · без генерации</button>
      <p className="video-muted">Проверяется {job ? 'сохранённый голос этой сборки' : 'Voice ID из поля ниже'}: {checkVoice || 'не указан'}. Разрешения ключа: User — Read, Voices — Read; для озвучки также Text to Speech — Access.</p>
      {checkedConnection && <div role="status"><p>API ответил · голос: <strong>{checkedConnection.voiceName}</strong> · тариф: {checkedConnection.tier}. Остаток квоты по данным API: {checkedConnection.remainingCharacters.toLocaleString('ru-RU')}. Проверено: {new Date(checkedConnection.checkedAt).toLocaleTimeString('ru-RU')}.</p><p className="video-muted">Это проверка сведений о подписке и голосе. Она не подтверждает разрешение генерации, качество озвучки или лимит конкретного ключа. Права на публикацию и расход проверяйте в кабинете ElevenLabs.</p></div>}
    </details>
    <div className="video-studio-grid">
      <aside className="video-panel video-brief">
        <p className="eyebrow">01 / СЦЕНАРИЙ</p><h3>Основа ролика</h3>
        <p className="video-script">{job?.text || script}</p>
        <p className="video-muted">{(job?.text || script).length} символов · сохранённая версия сценария<br />Источник: {({ manual: 'ручной ввод', test: 'тестовый шаблон', yandex: 'YandexGPT' } as Record<string, string>)[job?.source || scriptSource] || 'не указан'}</p>
        <label htmlFor="video-voice">Voice ID ElevenLabs</label><input id="video-voice" value={voice} onChange={e => setVoice(e.target.value)} maxLength={100} disabled={!!busy} />
        <p className="video-muted">Для новой сборки. {job ? `Текущая сборка использует голос ${job.voiceId}. Для смены голоса создайте новую сборку.` : 'В ElevenLabs откройте My Voices → меню голоса → Copy voice ID.'}</p>
        <button type="button" className="button" disabled={!!busy || !voice.trim() || normalizeNarration(script).length > productionLimits.characters} onClick={create}>{job ? 'Новая сборка' : 'Подготовить кадры'} <span aria-hidden="true">→</span></button>
        {normalizeNarration(script).length > productionLimits.characters && <p role="alert">Первый вариант производства рассчитан на сценарий до {productionLimits.characters} символов. Сохраните короткую версию для проверки.</p>}
        <p className="video-muted">Подготовка плана бесплатна. Текст делится на кадры автоматически; описания можно поправить.</p>
        {jobs.length > 0 && <><label htmlFor="video-history">Сборки этой версии</label><select id="video-history" value={selected} disabled={!!busy} onChange={e => {
          if (dirty && !window.confirm('Описания не сохранены. Переключить сборку?')) return;
          setSelected(e.target.value); setDrafts({}); setDraftRevision(undefined); setConfirmed(false);
        }}>{jobs.map((j, i) => <option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleString('ru-RU')} · {statusLabel[j.status]} {i === 0 ? '· последняя' : ''}</option>)}</select></>}
      </aside>
      <div className="video-panel video-frames">
        <div className="video-panel-title"><div><p className="eyebrow">02 / КАДРЫ</p><h3>Визуальная история</h3></div>{dirty && <button className="button secondary" type="button" onClick={save} disabled={!!busy}>Сохранить описания</button>}</div>
        {!job ? <div className="video-empty"><span className="video-empty-number">01 — 06</span><h4>Здесь появятся кадры</h4><p>Подготовьте план из сценария. Затем создайте изображения и озвучку.</p></div> : <ol className="video-shot-list">{job.shots.map((shot, index) => <li className="video-shot" key={shot.id}>
          <div className="video-shot-image">{shot.image.file ? <Image unoptimized width={1280} height={720} src={assetURL(shot.image.file)} alt={`Изображение кадра ${index + 1}`} /> : <span>КАДР {String(index + 1).padStart(2, '0')}<small>{shot.image.state === 'pending' ? 'Создаётся в FLUX' : shot.image.state === 'unknown' ? 'Результат запроса неизвестен' : 'Изображение ещё не создано'}</small></span>}</div>
          <div className="video-shot-copy"><p>{shot.text}</p><details><summary>Описание изображения</summary><label className="sr-only" htmlFor={`prompt-${shot.id}`}>Описание кадра {index + 1}</label><textarea id={`prompt-${shot.id}`} rows={4} maxLength={productionLimits.prompt} value={drafts[shot.id] ?? shot.prompt} disabled={!!busy} onChange={e => { if (!dirty) setDraftRevision(job.revision); setDrafts(old => ({ ...old, [shot.id]: e.target.value })); }} /></details>
            {shot.image.file && <small className="video-muted">Источник: FLUX1.1 pro{shot.image.generatedPrompt !== shot.prompt ? ' · описание изменено после генерации' : ''}</small>}
            {(shot.image.file || shot.image.state === 'unknown' || shot.image.state === 'failed') && <button type="button" className="video-text-button" disabled={!!busy || dirty || !canImage} onClick={() => operate('replace', shot.id)}>Новое изображение · ≈ $0.04</button>}
          </div>
        </li>)}</ol>}
      </div>
      <aside className="video-panel video-result">
        <p className="eyebrow">03 / ВИДЕО</p><h3>Посмотрите результат</h3>
        <div className="video-preview">{job?.output ? <video key={job.output} controls preload="metadata" src={assetURL(job.output)} aria-label="Собранное видео" /> : <div><span aria-hidden="true">▷</span><p>Здесь будет ваш ролик</p><small>Изображения с движением, голос и субтитры</small></div>}</div>
        {job && <><p className="video-status" role="status"><strong>{statusLabel[job.status]}</strong><br />{job.message}</p>
          {job.outputStale && <p className="video-alert">Материалы изменены. В проигрывателе предыдущая сборка; соберите видео заново.</p>}
          {job.audio.file && <div className="video-audio"><label>Озвучка · ElevenLabs</label><audio controls preload="metadata" src={assetURL(job.audio.file)} /><a className="video-text-button" href={assetURL(job.audio.file, true)}>Скачать озвучку MP3</a></div>}
          <div className="video-cost"><span>Недостающие материалы</span><strong>≈ {usd(cost)}</strong><small>Ориентир по API-тарифам на {productionRates.checked}, без налогов, комиссий и возможной надбавки за голос. Подписка и минимальное пополнение оплачиваются отдельно; запрос может расходовать включённые кредиты. Запросов в истории: {job.attempts.length}; сумма их оценок ≈ {usd(job.attempts.reduce((sum, a) => sum + a.estimatedUSD, 0))}. Фактические списания — в кабинетах провайдеров.</small></div>
          <label htmlFor="video-budget">Предел оценки следующего запуска, USD</label><input id="video-budget" type="number" min="0.04" max="10" step="0.01" value={budget} onChange={e => { setBudget(e.target.value); setConfirmed(false); }} disabled={!!busy} />
          <label className="video-consent"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={!!busy} />Разрешаю указанные платные запросы в пределах оценки. Списание при ошибке возможно.</label>
          {!job.audio.file && <><button type="button" className="button secondary" disabled={!!busy || dirty || !canSpeak || !confirmed || job.audio.state === 'unknown'} onClick={() => operate('speech')}>Создать только озвучку · ≈ {usd(estimatedCost(job, 'speech'))}</button><p className="video-muted">Один запрос ElevenLabs, {job.text.length} символов, Multilingual v2. Изображения не создаются. {job.audio.state === 'unknown' ? 'Результат прошлой озвучки неизвестен: проверьте историю ElevenLabs перед новым запросом.' : 'Сначала прослушайте голос, затем создавайте остальные материалы.'}</p></>}
          <button type="button" className="button" disabled={!!busy || dirty || !canGenerate || (cost > 0 && !confirmed)} onClick={() => operate('generate')}>{busy ? 'Идёт работа…' : `Создать недостающие материалы · ≈ ${usd(cost)}`}</button>
          {job.shots.some(s => s.image.state === 'pending') && <button type="button" className="button secondary" disabled={!!busy || dirty || !setup.workerOnline} onClick={() => operate('check')}>Проверить задачи BFL · без новой генерации</button>}
          <button type="button" className="button secondary" disabled={!!busy || dirty || !setup.workerOnline || !job.audio.file || job.shots.some(s => !s.image.file)} onClick={() => operate('render')}>Собрать MP4 на компьютере</button>
          {job.output && <a className="button secondary" href={assetURL(job.output, true)}>Скачать MP4</a>}
          <button type="button" className="video-text-button" onClick={() => void refresh()}>Обновить состояние</button>
        </>}
      </aside>
    </div>
  </section>;
}
