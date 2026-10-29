'use client';
import { useId } from 'react';
import { visualGuideLimit } from '@/lib/production/visual-style';

export function FrameVisualGuide({ value, onChange, onSave, disabled, dirty, promptLengths }: {
  value: string; onChange: (value: string) => void; onSave: () => void; disabled: boolean; dirty: boolean; promptLengths: number[];
}) {
  const id = useId(), overlong = promptLengths.flatMap((length, index) => length > 2000 ? [index + 1] : []);
  return <details className="frame-visual-guide">
    <summary>Общие детали кадров <span>{value.trim() ? 'добавлены' : 'необязательно'}</span></summary>
    <p>Опишите героев, место и детали, которые должны сохраняться в разных сценах. Этот текст добавится к промптам всех кадров для Flow и генерации по API.</p>
    <label htmlFor={id}>Что должно оставаться одинаковым</label>
    <textarea id={id} rows={4} maxLength={visualGuideLimit} value={value} disabled={disabled} aria-describedby={`${id}-hint ${id}-length`} onChange={event => onChange(event.target.value)} placeholder="Анна: короткие тёмные волосы, зелёное пальто, красный рюкзак. Город: современный Берлин, пасмурное утро. Сдержанные цвета, естественный свет." />
    <p id={`${id}-length`} className="video-muted">{value.length} / {visualGuideLimit} символов</p>
    <p id={`${id}-hint`} className="video-muted">В описании отдельного кадра указывайте, кто присутствует и что делает. Перечень героев здесь не означает, что все должны быть в каждой сцене. Для одинаковых лиц в Flow прикладывайте удачное изображение как референс; текст сам по себе этого не гарантирует.</p>
    {overlong.length > 0 && <p className="field-error" role="status">Промпт длиннее 2000 символов в кадрах: {overlong.slice(0, 8).join(', ')}{overlong.length > 8 ? '…' : ''}. Сократите общие детали или описания этих кадров.</p>}
    {dirty && <button type="button" className="button secondary" disabled={disabled || overlong.length > 0} onClick={onSave}>Сохранить описания и общие детали</button>}
    <p className="video-muted">Сохранение не запускает генерацию. Готовые изображения, голос и клипы сохраняются.</p>
  </details>;
}
