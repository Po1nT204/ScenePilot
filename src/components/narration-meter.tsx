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
  <div className="narration-summary">
   <p><strong>Озвучка: {estimate ? `≈ ${formatDuration(estimate.seconds)} · ${estimate.words} слов` : 'укажите темп'}</strong></p>
   <p>{targetLabel}: {formatDuration(targetSeconds)}</p>
   {estimate && <p className={estimate.fit==='short'||estimate.fit==='long' ? 'timing-warning' : ''}>{({empty:'Нет текста для оценки',short:'Короче цели',long:'Длиннее цели',near:'Близко к цели (±20%)'} as const)[estimate.fit]}</p>}
  </div>
  {!valid && <p className="form-message" role="status">Укажите целый темп от {narrationPace.min} до {narrationPace.max} в разделе «Темп и расчёт».</p>}
  {comparison && !!sceneCount && <p className={`narration-comparison${comparison.matches ? '' : ' timing-warning'}`}>{comparison.matches ? 'Озвучка совпадает со сценарием (без учёта пробелов).' : 'Озвучка отличается от сценария: проверьте пропуски, повторы и порядок.'}</p>}
  <details className="editor-help">
   <summary>Темп и расчёт · {valid ? `${pace} слов/мин` : 'укажите темп'}</summary>
  <label htmlFor={id}>Темп чтения, слов в минуту</label>
  <input id={id} type="text" inputMode="numeric" value={pace} disabled={disabled} onChange={e=>setPace(e.target.value)} aria-describedby={`${id}-hint`} aria-invalid={!valid} />
  <p className="field-hint" id={`${id}-hint`}>Условный темп для планирования: {narrationPace.min}–{narrationPace.max}. Настройка действует только на этом экране и не сохраняется. Паузы, музыка и скорость диктора не учтены; заголовки и инструкции тоже считаются словами.</p>
  {estimate && <>
   <p>Для цели при этом темпе — около {estimate.targetWords} слов. «Короче» или «длиннее» означает отклонение больше 20%.</p>
   {sceneCount !== undefined && sceneCount > 0 && <p>{sceneCount} сцен · в среднем около {formatDuration(estimate.seconds/sceneCount)} озвучки на сцену. Реальные сцены могут быть разной длины.</p>}
  </>}
  {comparison && <p>Сценарий: {comparison.scriptWords} слов; сцены: {comparison.narrationWords}. Сравнение игнорирует пробелы и переносы строк; это проверка текста, а не смысла.</p>}
  </details>
 </section>;
}
