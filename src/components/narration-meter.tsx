"use client";
import {useId,useState} from 'react';
import {compareNarration,estimateNarration,formatDuration,narrationPace} from '@/lib/narration';

export function NarrationMeter({text,targetSeconds,targetLabel,sourceText,sceneCount,disabled=false}: {text:string;targetSeconds:number;targetLabel:string;sourceText?:string;sceneCount?:number;disabled?:boolean}) {
 const id=useId();
 const [pace,setPace]=useState<string>(String(narrationPace.default));
 const number=Number(pace);
 const valid=/^\d+$/.test(pace) && number>=narrationPace.min && number<=narrationPace.max;
 const estimate=valid ? estimateNarration(text,targetSeconds,number) : null;
 const comparison=sourceText !== undefined ? compareNarration(sourceText,text) : null;
 return <section className="narration-meter" aria-label="Оценка озвучки">
  <h3>Оценка озвучки</h3>
  <p>{targetLabel}: {formatDuration(targetSeconds)}.</p>
  <label htmlFor={id}>Темп чтения, слов в минуту</label>
  <input id={id} type="text" inputMode="numeric" value={pace} disabled={disabled} onChange={e=>setPace(e.target.value)} aria-describedby={`${id}-hint`} aria-invalid={!valid} />
  <p className="field-hint" id={`${id}-hint`}>Условный темп для планирования: {narrationPace.min}–{narrationPace.max}. Настройка действует только на этом экране и не сохраняется. Паузы, музыка и скорость диктора не учтены; заголовки и инструкции тоже считаются словами.</p>
  {!estimate ? <p>Укажите целый темп от {narrationPace.min} до {narrationPace.max}.</p> : <>
   <p><strong>{estimate.words} слов · примерно {formatDuration(estimate.seconds)}</strong>. Для цели при этом темпе — около {estimate.targetWords} слов.</p>
   <p>{({empty:'Добавьте текст озвучки для оценки.',short:'Текущий текст заметно короче цели при выбранном темпе.',long:'Текущий текст заметно длиннее цели при выбранном темпе.',near:'Объём близок к цели при выбранном темпе (в пределах ±20%).'} as const)[estimate.fit]}</p>
   {sceneCount !== undefined && sceneCount > 0 && <p>{sceneCount} сцен · в среднем около {formatDuration(estimate.seconds/sceneCount)} озвучки на сцену. Реальные сцены могут быть разной длины.</p>}
  </>}
  {comparison && <p>{!sceneCount ? 'Добавьте сцены, чтобы сравнить озвучку со сценарием.' : comparison.matches ? 'Озвучка сцен совпадает со сценарием без учёта пробелов и переносов строк.' : 'Озвучка сцен отличается от сохранённого сценария. Проверьте пропуски, повторы и порядок.'} Сценарий: {comparison.scriptWords} слов; сцены: {comparison.narrationWords}. Это сравнение текста, а не проверка смысла.</p>}
 </section>;
}
