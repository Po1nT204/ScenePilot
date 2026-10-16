"use client";
import {useRef,useState} from "react";
import {exportFilename,exportScenes,exportText,sourceLabel,type ExportDocument,type ExportFormat,type ExportMode} from "@/lib/export";
export function ExportPanel({document}:{document:ExportDocument}) {
 const [mode,setMode]=useState<ExportMode>("narration");
 const [archiveFormat,setArchiveFormat]=useState<ExportFormat>("txt");
 const [message,setMessage]=useState("");
 const [copying,setCopying]=useState(false);
 const preview=useRef<HTMLTextAreaElement>(null);
 const promptFields=useRef<Record<number,HTMLTextAreaElement|null>>({});
 const format=mode==="archive"?archiveFormat:"txt";
 const scenes=exportScenes(document);
 const text=exportText(document,format,mode);
 const empty=mode==="visuals" && scenes.length===0;
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
  {empty ? <p role="status">В этой версии нет сохранённых сцен. Сначала добавьте и сохраните их во вкладке «Сцены».</p> : <>
   <div className="export-actions">
    <button className="button" disabled={copying} onClick={download}>Скачать {format==="txt"?"TXT":"Markdown"}</button>
    <button className="text-button" disabled={copying} onClick={()=>copy(text,preview.current)}>Скопировать {format==="txt"?"текст":"Markdown"}</button>
   </div>
   <label htmlFor="export-preview">Предпросмотр — {mode==="narration"?"текст озвучки":mode==="visuals"?"визуальные промпты":"полный архив"}</label>
   <textarea id="export-preview" ref={preview} readOnly value={text} rows={16} spellCheck={false} />
  </>}
  <p role="status">{message}</p>
  {mode==="visuals" && !empty && <details>
   <summary>Скопировать отдельный промпт</summary>
   {scenes.map(scene=><div key={scene.position}>
    <label htmlFor={`export-prompt-${scene.position}`}>Сцена {scene.position} · {sourceLabel(scene.source)}</label>
    <textarea id={`export-prompt-${scene.position}`} ref={field=>{promptFields.current[scene.position]=field;}} readOnly value={scene.visual_prompt} rows={4} spellCheck={false} />
    <button className="text-button" disabled={copying} onClick={()=>copy(scene.visual_prompt,promptFields.current[scene.position])}>Скопировать промпт сцены {scene.position}</button>
   </div>)}
  </details>}
 </section>;
}
