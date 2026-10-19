'use client';
import { useState } from 'react';
import { hookOptions, retentionOptions, endingOptions, qualityRecipe } from '@/lib/content-quality';

export function ContentQualityBuilder({ onAppend }: { onAppend: (recipe: string) => void }) {
  const [hook, setHook] = useState<keyof typeof hookOptions>('question');
  const [retention, setRetention] = useState<keyof typeof retentionOptions>('explain');
  const [ending, setEnding] = useState<keyof typeof endingOptions>('answer');
  const recipe = qualityRecipe(hook, retention, ending);
  return <details className="channel-quality-builder">
    <summary>Хук, удержание и финал</summary>
    <p>Соберите требования к сценарию, проверьте текст и добавьте его в формат канала. Это бесплатный шаблон, без вызова ИИ.</p>
    <label htmlFor="quality-hook">Начало — чем заинтересовать</label>
    <select id="quality-hook" value={hook} onChange={e => setHook(e.target.value as typeof hook)}>{Object.entries(hookOptions).map(([id, option]) => <option key={id} value={id}>{option.label}</option>)}</select>
    <label htmlFor="quality-retention">Развитие — зачем смотреть дальше</label>
    <select id="quality-retention" value={retention} onChange={e => setRetention(e.target.value as typeof retention)}>{Object.entries(retentionOptions).map(([id, option]) => <option key={id} value={id}>{option.label}</option>)}</select>
    <label htmlFor="quality-ending">Финал — что получит зритель</label>
    <select id="quality-ending" value={ending} onChange={e => setEnding(e.target.value as typeof ending)}>{Object.entries(endingOptions).map(([id, option]) => <option key={id} value={id}>{option.label}</option>)}</select>
    <p className="project-full-topic" aria-live="polite">{recipe}</p>
    <button type="button" className="text-button" onClick={() => onAppend(recipe)}>Добавить требования в формат</button>
    <p>Затем можно отредактировать текст ниже и нажать «Сохранить профиль». Сами по себе эти требования не гарантируют просмотров.</p>
  </details>;
}
