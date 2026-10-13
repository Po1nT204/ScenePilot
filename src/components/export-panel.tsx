"use client";
import {useRef,useState} from "react";
import {exportFilename,exportText,type ExportDocument,type ExportFormat} from "@/lib/export";
export function ExportPanel({document}:{document:ExportDocument}) {
 const [format,setFormat]=useState<ExportFormat>("txt");
 const [message,setMessage]=useState("");
 const preview=useRef<HTMLTextAreaElement>(null);
 const text=exportText(document,format);
 function download(selected:ExportFormat) {
  try {
   const content=exportText(document,selected);
   const blob=new Blob([selected==="txt"?"\uFEFF":"",content],{type:selected==="txt"?"text/plain;charset=utf-8":"text/markdown;charset=utf-8"});
   const url=URL.createObjectURL(blob);
   const link=window.document.createElement("a");
   link.href=url;link.download=exportFilename(document,selected);
   window.document.body.appendChild(link);
   try {link.click();setMessage("Скачивание файла запрошено. Проверьте загрузки браузера.");}
   finally {link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
  } catch {setMessage("Не удалось подготовить файл. Попробуйте скопировать текст из предпросмотра.");}
 }
 async function copy() {
  try {await navigator.clipboard.writeText(text);setMessage("Текст скопирован.");}
  catch {preview.current?.focus();preview.current?.select();setMessage("Браузер не разрешил копирование. Текст выделен: нажмите Ctrl+C (или ⌘C).");}
 }
 return <section className="export-panel">
  <div className="export-actions">
   <button className="button" onClick={()=>download("txt")}>Скачать TXT</button>
   <button className="text-button" onClick={()=>download("md")}>Скачать Markdown</button>
  </div>
  <div className="project-form">
   <label htmlFor="export-format">Формат предпросмотра и копирования</label>
   <select id="export-format" value={format} onChange={event=>{setFormat(event.target.value as ExportFormat);setMessage("");}}>
    <option value="txt">TXT — обычный текст</option><option value="md">Markdown</option>
   </select>
   <button className="text-button" onClick={copy}>Скопировать {format==="txt"?"текст":"Markdown"}</button>
   <p role="status">{message}</p>
   <label htmlFor="export-preview">Предпросмотр файла — версия {document.versionNumber}</label>
   <textarea id="export-preview" ref={preview} readOnly value={text} rows={24} spellCheck={false} />
  </div>
 </section>;
}
