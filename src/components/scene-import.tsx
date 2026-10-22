'use client';
import { useState } from 'react';
import { importSceneText } from '@/lib/scene-import';
import type { SceneEdit } from '@/lib/scene-editing';
export function SceneImport({ disabled, onImport }: { disabled: boolean; onImport: (scenes: SceneEdit[]) => void }) {
  const [text, setText] = useState(''), [error, setError] = useState('');
  function apply() {
    try { const scenes = importSceneText(text); onImport(scenes); setError(''); }
    catch(e) { setError((e as Error).message); }
  }
  return <details className="editor-help"><summary>Вставить сцены из Claude или другой модели</summary>
    <p>Вставьте весь ответ: «СЦЕНА 01», затем «Описание:», «Визуальный промпт:», «Озвучка:». Также принимается JSON с массивом scenes. Импорт меняет только черновик; сохраните его отдельно.</p>
    <label htmlFor="scene-import-text">Текст сцен</label><textarea id="scene-import-text" value={text} onChange={e => setText(e.target.value)} rows={8} maxLength={80000} disabled={disabled} />
    <button type="button" className="text-button" onClick={apply} disabled={disabled || !text.trim()}>Разобрать и вставить в редактор</button>
    <p role="status">{error}</p>
  </details>;
}
