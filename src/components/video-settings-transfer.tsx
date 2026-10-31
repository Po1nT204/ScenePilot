import type { VideoView } from '@/lib/production/model';
import { productionSettings } from '@/lib/production/settings';
import { imageCatalog } from '@/lib/production/image-catalog';
import { visualStyles } from '@/lib/production/visual-style';

export function VideoSettingsTransfer({ job, checked, disabled, dirty, onChange }: {
  job: VideoView; checked: boolean; disabled: boolean; dirty: boolean; onChange: (value: boolean) => void;
}) {
  let settings;
  try { settings = productionSettings(job); } catch { /* The server also validates before writing. */ }
  return <div className="video-settings-transfer">
    <label className="video-consent"><input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />Использовать настройки текущей сборки</label>
    {checked && <>
      <p className="video-muted">{job.chapter ? `Из части ${job.chapter.number} · ` : ''}{new Date(job.createdAt).toLocaleString('ru-RU')}. Переносится сохранённая копия настроек.</p>
      {settings ? <><dl className="video-settings-list">
        <div><dt>Голос</dt><dd>{settings.voiceId}</dd></div>
        <div><dt>Изображения</dt><dd>{settings.imageProvider === 'none' ? 'Ручной перенос, без API' : imageCatalog[settings.imageProvider].label}</dd></div>
        <div><dt>Стиль</dt><dd>{visualStyles[settings.visualStyle].label}</dd></div>
        <div><dt>Субтитры</dt><dd>{settings.subtitlesEnabled ? 'Включены' : 'Выключены'}</dd></div>
      </dl>{settings.visualGuide ? <details><summary>Общие детали кадров · будут перенесены</summary><p className="video-prompt-preview">{settings.visualGuide}</p></details> : <p className="video-muted">Общие детали кадров пока не заданы.</p>}</> : <p role="alert">Настройки не удалось прочитать. Отключите перенос и задайте их заново.</p>}
      {dirty && <p role="status" className="video-alert">Сначала сохраните описания и общие детали кадров, чтобы перенести последнюю правку.</p>}
      <p className="video-muted">Озвучка, изображения и клипы создаются для нового текста отдельно. Запросы к моделям не запускаются.</p>
    </>}
  </div>;
}
