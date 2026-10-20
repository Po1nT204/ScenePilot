'use client';
import { useId, useState } from 'react';
import { flowCameraMoves, flowMotionPrompt, type FlowCameraMove } from '@/lib/production/flow-handoff';

export function FlowHandoff({ imageURL, description, disabled, sceneNumber, hasClip, onImport }: {
  imageURL: string; description: string; disabled: boolean; sceneNumber: number;
  hasClip: boolean; onImport: (file: File) => void;
}) {
  const id = useId();
  const [camera, setCamera] = useState<FlowCameraMove>('still');
  const [message, setMessage] = useState('');
  const prompt = flowMotionPrompt(description, camera);
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setMessage('Промпт скопирован. Вставьте его в Flow и уточните нужное движение.'); }
    catch { setMessage('Не удалось скопировать автоматически. Выделите текст в поле ниже и нажмите Ctrl+C.'); }
  }
  return <details className="flow-handoff"><summary>Анимировать кадр {sceneNumber} в Flow</summary>
    <ol className="flow-steps">
      <li><strong>Подготовьте кадр</strong><p>Скачайте изображение и добавьте в Flow как начальный кадр.</p>
        <a className="video-text-button" href={imageURL}>Скачать изображение</a>
      </li>
      <li><strong>Задайте движение</strong>
        <label htmlFor={`${id}-camera`}>Камера</label>
        <select id={`${id}-camera`} value={camera} disabled={disabled} onChange={event => { setCamera(event.target.value as FlowCameraMove); setMessage(''); }}>
          {Object.entries(flowCameraMoves).map(([value, move]) => <option key={value} value={value}>{move.label}</option>)}
        </select>
        <p>Выбор камеры относится к промпту Flow, действует до обновления страницы. Движение персонажей уточните в Flow.</p>
        <details><summary>Посмотреть промпт</summary><textarea aria-label={`Промпт Flow для кадра ${sceneNumber}`} rows={5} readOnly value={prompt} /></details>
    <button type="button" className="video-text-button" disabled={disabled} onClick={() => void copy()}>Скопировать промпт анимации</button>
    {message && <p role="status" className="video-muted">{message}</p>}
        <p><a className="button secondary" href="https://labs.google/fx/tools/flow" target="_blank" rel="noreferrer">Открыть Flow ↗</a></p>
        <p>На сайте выберите Veo, один результат и проверьте расход кредитов. Здесь генерация не запускается.</p>
      </li>
      <li><strong>Верните клип в кадр {sceneNumber}</strong>
        <label htmlFor={`${id}-clip`}>{hasClip ? 'Заменить MP4 этой сцены' : 'Загрузить скачанный MP4'}</label>
        <input id={`${id}-clip`} type="file" accept="video/mp4,.mp4" disabled={disabled} onChange={event => {
          const file = event.target.files?.[0];
          if (file) onImport(file);
          event.target.value = '';
        }} />
        <p>До 32 МиБ и 60 секунд. Озвучка ролика сохранится; звук клипа в монтаж не попадёт.</p>
      </li>
    </ol>
  </details>;
}
