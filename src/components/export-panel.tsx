"use client";
import {useRef,useState} from "react";
import {exportFilename,exportScenes,exportShots,exportText,sourceLabel,type ExportDocument,type ExportFormat,type ExportMode} from "@/lib/export";
export function ExportPanel({document}:{document:ExportDocument}) {
 const [mode,setMode]=useState<ExportMode>("narration");
 const [archiveFormat,setArchiveFormat]=useState<ExportFormat>("txt");
 const [message,setMessage]=useState("");
 const [copying,setCopying]=useState(false);
 const preview=useRef<HTMLTextAreaElement>(null);
 const promptFields=useRef<Record<number,HTMLTextAreaElement|null>>({});
 const format=mode==="archive"?archiveFormat:"txt";
 const scenes=exportScenes(document);
 const shots=exportShots(document);
 const prompts=mode==='shots' ? shots.map((shot,index)=>({key:index,label:`Кадр ${scenes.find(scene=>scene.id===shot.scene_id)!.position}.${shot.position}`,source:shot.source,text:shot.visual_prompt})) : scenes.map(scene=>({key:scene.position,label:`Сцена ${scene.position}`,source:scene.source,text:scene.visual_prompt}));
 const text=exportText(document,format,mode);
 const empty=(mode==="visuals" || mode==='shots') && prompts.length===0;
 function download() {
  if(empty) return;
  try {
   const blob=new Blob([text],{type:format==="txt"?"text/plain;charset=utf-8":"text/markdown;charset=utf-8"});
   const url=URL.createObjectURL(blob);
   const link=window.document.createElement("a");
   link.href=url;link.download=exportFilename(document,format,mode);
   window.document.body.appendChild(link);
   try {link.click();setMessage("Скачивание файла запрошено. Проверьте загрузки браузера.");}
   finally {link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
  } catch {setMessage("Не удалось подготовить файл. Попробуйте скопировать текст из предпросмотра.");}
 }
 async function copy(content:string,field:HTMLTextAreaElement|null) {
  setCopying(true);
  try {await navigator.clipboard.writeText(content);setMessage("Текст скопирован.");}
  catch {field?.focus();field?.select();setMessage("Браузер не разрешил копирование. Текст выделен: нажмите Ctrl+C (или ⌘C).");}
  finally {setCopying(false);}
 }
 return <section className="export-panel project-form">
  <label htmlFor="export-mode">Что экспортировать</label>
  <select id="export-mode" value={mode} disabled={copying} onChange={event=>{setMode(event.target.value as ExportMode);setMessage("");}}>
   <option value="narration">Текст озвучки</option>
   <option value="visuals">Визуальные промпты</option>
   <option value="shots">Промпты кадров</option>
   <option value="archive">Полный архив</option>
  </select>
  {mode==="archive" && <>
   <label htmlFor="export-format">Формат файла и копирования</label>
   <select id="export-format" value={archiveFormat} disabled={copying} onChange={event=>{setArchiveFormat(event.target.value as ExportFormat);setMessage("");}}>
    <option value="txt">TXT — обычный текст</option><option value="md">Markdown</option>
   </select>
  </>}
  <p>Версия {document.versionNumber} · Источник сценария: {sourceLabel(document.source)}</p>
  {mode!=="narration" && scenes.length>0 && <p>Источники сцен: {[...new Set(scenes.map(scene=>sourceLabel(scene.source)))].join(", ")}</p>}
  {mode==="narration" && <p>Сохранённый сценарий без добавленного оформления.</p>}
  {mode==="visuals" && !empty && <p>Сохранённые промпты по порядку сцен, разделитель — «---».</p>}
  {mode==='shots' && !empty && <p>Источники кадров: {[...new Set(shots.map(shot=>sourceLabel(shot.source)))].join(', ')}. Порядок: эпизод, затем кадр; разделитель — «---».</p>}
  {mode==='shots' && shots.some(shot=>document.shotPlans?.find(plan=>plan.scene_id===shot.scene_id)?.narration_snapshot!==scenes.find(scene=>scene.id===shot.scene_id)?.narration) && <p role="alert">Часть планов требует сверки с озвучкой эпизодов. Экспорт содержит сохранённые промпты.</p>}
  {empty ? <p role="status">{mode==='shots'?'В этой версии нет сохранённых кадров. Откройте кадры эпизода во вкладке «Сцены» и сохраните план.':'В этой версии нет сохранённых сцен. Сначала добавьте и сохраните их во вкладке «Сцены».'}</p> : <>
   <div className="export-actions">
    <button className="button" disabled={copying} onClick={download}>Скачать {format==="txt"?"TXT":"Markdown"}</button>
    <button className="text-button" disabled={copying} onClick={()=>copy(text,preview.current)}>Скопировать {format==="txt"?"текст":"Markdown"}</button>
   </div>
   <label htmlFor="export-preview">Предпросмотр — {mode==="narration"?"текст озвучки":mode==="visuals"?"визуальные промпты":mode==='shots'?'промпты кадров':"полный архив"}</label>
   <textarea id="export-preview" ref={preview} readOnly value={text} rows={16} spellCheck={false} />
  </>}
  <p role="status">{message}</p>
  {(mode==="visuals" || mode==='shots') && !empty && <details>
   <summary>Скопировать отдельный промпт</summary>
   {prompts.map(prompt=><div key={prompt.key}>
    <label htmlFor={`export-prompt-${prompt.key}`}>{prompt.label} · {sourceLabel(prompt.source)}</label>
    <textarea id={`export-prompt-${prompt.key}`} ref={field=>{promptFields.current[prompt.key]=field;}} readOnly value={prompt.text} rows={4} spellCheck={false} />
    <button className="text-button" disabled={copying} onClick={()=>copy(prompt.text,promptFields.current[prompt.key])}>Скопировать промпт · {prompt.label}</button>
   </div>)}
  </details>}
 </section>;
}
