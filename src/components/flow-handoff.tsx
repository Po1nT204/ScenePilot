'use client';
import { useState } from 'react';

export function FlowHandoff({ imageURL, description, disabled }: { imageURL: string; description: string; disabled: boolean }) {
  const [message, setMessage] = useState('');
  const prompt = `Animate the supplied first frame into one continuous shot. Preserve the identity, appearance and composition of the existing subjects. Give the subjects natural, physically plausible movement appropriate to the scene, with subtle environmental motion. Keep camera movement gentle and coherent. No cuts, new subjects, captions or text. Scene description: ${description}`;
  async function copy() {
    try { await navigator.clipboard.writeText(prompt); setMessage('Промпт скопирован. Вставьте его в Flow и уточните нужное движение.'); }
    catch { setMessage('Не удалось скопировать автоматически. Выделите текст в поле ниже и нажмите Ctrl+C.'); }
  }
  return <details><summary>Анимировать этот кадр в Veo / Flow</summary>
    <p className="video-muted">Скачайте изображение и добавьте его в Flow как начальный кадр. Выберите Veo и проверьте расход кредитов перед генерацией. Готовый MP4 загрузите в эту сцену через «Добавить MP4-клип».</p>
    <a className="video-text-button" href={imageURL}>Скачать кадр для Flow</a>{' · '}
    <a className="video-text-button" href="https://labs.google/fx/tools/flow" target="_blank" rel="noreferrer">Открыть Flow</a>
    <p className="video-muted">Это шаблон описания движения, не запрос к модели. Отредактируйте его в Flow под нужное действие.</p>
    <textarea aria-label="Промпт анимации для Flow" rows={5} readOnly value={prompt} />
    <button type="button" className="video-text-button" disabled={disabled} onClick={() => void copy()}>Скопировать промпт анимации</button>
    {message && <p role="status" className="video-muted">{message}</p>}
  </details>;
}
