'use client';
import { useState } from 'react';
import type { ReleasePart, ReleaseView } from '@/lib/production/release-model';
import { formatDuration } from '@/lib/narration';

export function VideoReleasePanel({ projectId, versionId, parts, releases, disabled, workerOnline, onAssemble, onRefresh }: {
  projectId: string; versionId: string; parts: ReleasePart[]; releases: ReleaseView[]; disabled: boolean; workerOnline: boolean;
  onAssemble: (selection: { id: string; revision: number }[]) => void; onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<Record<number, string>>({});
  const [previewId, setPreviewId] = useState('');
  if (parts.length < 2) return null;
  // Keep a deliberate selection even if it becomes stale; never silently switch to an older MP4.
  const chosen = parts.map(part => selected[part.number] ? part.choices.find(choice => choice.id === selected[part.number]) : part.choices[0]);
  const ready = chosen.filter(choice => choice?.ready).length;
  const active = releases.find(release => release.status === 'queued' || release.status === 'running');
  const completed = releases.filter(release => release.status === 'ready');
  const preview = completed.find(release => release.id === previewId) ?? completed[0];
  const latest = active ?? releases[0];
  const mixedVoice = new Set(chosen.filter(Boolean).map(choice => choice!.voiceId)).size > 1;
  const mixedSubtitles = new Set(chosen.filter(Boolean).map(choice => choice!.subtitles)).size > 1;
  const asset = (id: string, download = false) => `/projects/${projectId}/video/releases/${id}?version=${versionId}${download ? '&download=1' : ''}`;
  return <section className="video-release" aria-labelledby="video-release-title">
    <div className="video-release-heading"><div><p className="eyebrow">ВЕСЬ РОЛИК</p><h3 id="video-release-title">Объединить части</h3></div><span>{ready} из {parts.length} готовы</span></div>
    <p className="video-muted">Готовые MP4 соединятся по порядку. Голос, кадры и субтитры останутся такими, как в выбранных частях.</p>
    <ol className="video-release-parts">{parts.map((part, index) => <li key={part.number}>
      <label htmlFor={`release-part-${part.number}`}>Часть {part.number}</label>
      {part.choices.length ? <div><select id={`release-part-${part.number}`} value={chosen[index]?.id ?? ''} disabled={disabled || !!active} onChange={event => setSelected(old => ({ ...old, [part.number]: event.target.value }))}>
        {!chosen[index] && <option value="">Выберите сборку</option>}
        {part.choices.map((choice, choiceIndex) => <option key={choice.id} value={choice.id}>{new Date(choice.createdAt).toLocaleString('ru-RU')}{choiceIndex === 0 ? ' · последняя' : ''} · {choice.ready ? 'MP4 готов' : choice.reason}</option>)}
      </select><small>{chosen[index]?.ready ? 'Готова к объединению' : chosen[index]?.reason || 'Выберите сборку части'}</small></div> : <p>Подготовьте эту часть на этапе «Сценарий» и соберите её MP4.</p>}
    </li>)}</ol>
    {(mixedVoice || mixedSubtitles) && <p className="video-alert">{mixedVoice && 'В частях выбраны разные голоса. '}{mixedSubtitles && 'Субтитры включены только в некоторых частях. '}Объединение сохранит эти различия.</p>}
    <div className="video-frame-actions"><button type="button" className="button" disabled={disabled || !!active || !workerOnline || ready !== parts.length} onClick={() => onAssemble(chosen.map(choice => ({ id: choice!.id, revision: choice!.revision })))}>Собрать весь ролик</button>
      <button type="button" className="video-text-button" disabled={disabled} onClick={onRefresh}>Обновить список</button></div>
    <p className="video-muted">Локально, без запросов к моделям и списания кредитов.{!workerOnline && <> Запустите <code>npm run video:worker</code>.</>}</p>
    {latest && <p role="status" className={latest.status === 'failed' ? 'video-alert' : 'video-muted'}>{latest.message}</p>}
    {preview && <div className="video-release-output">
      {completed.length > 1 && <><label htmlFor="release-preview">Готовый выпуск</label><select id="release-preview" value={preview.id} onChange={event => setPreviewId(event.target.value)}>{completed.map(release => <option key={release.id} value={release.id}>{new Date(release.createdAt).toLocaleString('ru-RU')}{release.stale ? ' · части изменены' : ''}</option>)}</select></>}
      <p><strong>Весь ролик · {preview.inputs.length} части · {formatDuration(preview.duration ?? 0)}</strong></p>
      {preview.stale && <p className="video-alert">После этого выпуска части изменились. Здесь сохранён предыдущий результат; для обновления выберите готовые части и соберите ролик заново.</p>}
      <video key={preview.id} controls preload="metadata" src={asset(preview.id)} aria-label="Весь ролик из частей" />
      <a className="button secondary" href={asset(preview.id, true)}>Скачать весь ролик · MP4</a>
    </div>}
  </section>;
}
