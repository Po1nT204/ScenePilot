'use client';
import { useEffect, useState, useTransition } from 'react';
import { connectRunwayAccount, getRunwayConnection, inspectRunwayConnection, removeRunwayConnection } from '@/app/projects/[id]/video/runway-actions';
import type { RunwayStatus } from '@/lib/production/runway-connect';
export function RunwayConnection({ projectId, versionId, disabled }: { projectId: string; versionId: string; disabled: boolean }) {
  const [status, setStatus] = useState<RunwayStatus>(), [error, setError] = useState(''), [pending, transition] = useTransition();
  useEffect(() => { let live = true; getRunwayConnection(projectId, versionId).then(r => { if (live) { setStatus(r.status); if (r.error) setError(r.error); } }).catch(() => { if (live) setError('Не удалось прочитать подключение Runway.'); }); return () => { live = false; }; }, [projectId, versionId]);
  function run(kind: 'connect' | 'check' | 'remove') {
    transition(async () => {
      setError('');
      try {
        if (kind === 'connect') { const r = await connectRunwayAccount(projectId, versionId); if (r.error) setError(r.error); else if (r.url) window.location.assign(r.url); }
        else { const r = await (kind === 'check' ? inspectRunwayConnection : removeRunwayConnection)(projectId, versionId); if (r.error) setError(r.error); else setStatus(r.status); }
      } catch { setError('Не удалось завершить действие Runway. Генерация не запускалась.'); }
    });
  }
  return <details className="video-connection"><summary>Runway · подключение подписки {status?.connected ? '· аккаунт подключён' : ''}</summary>
    <p>Вход через официальный Runway MCP использует аккаунт подписки, а не отдельный API-баланс. Подключение и проверка списка инструментов не создают видео и не расходуют кредиты генерации.</p>
    <p>На странице тарифов Runway MCP указан начиная с Pro. Доступ конкретного аккаунта проверяется после входа; Standard для этого подключения не обещаем.</p>
    <p>Это этап подключения. Автоматическая генерация Runway / Veo ещё не включена: сначала проверим инструменты аккаунта. Уже готовый MP4 можно добавить к кадру ниже.</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="button secondary" disabled={disabled || pending || (!status && !error)} onClick={() => run('connect')}>{status?.connected ? 'Подключить Runway заново' : 'Подключить аккаунт Runway'}</button>
    {status?.connected && <><button type="button" className="button secondary" disabled={disabled || pending} onClick={() => run('check')}>Проверить инструменты · без генерации</button>
      <button type="button" className="video-text-button" disabled={disabled || pending} onClick={() => run('remove')}>Отключить от ScenePilot</button>
      <p className="video-muted">Отключение удаляет доступ на этом компьютере; разрешение в аккаунте Runway при необходимости отзывается отдельно.</p></>}
    {status?.checkedAt && <p role="status">Каталог получен: {status.toolNames?.length ?? 0} инструментов. Проверено: {new Date(status.checkedAt).toLocaleString('ru-RU')}. Генерация и остаток кредитов не проверялись.</p>}
  </details>;
}
