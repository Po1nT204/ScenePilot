import { channelSnapshot, channelSummary, type ChannelProfile } from "./channel";
export type ExportSnapshot = {
 title:string;topic:string;genre:string;style:string;language:string;target_duration_seconds:number;
 channel?: ChannelProfile | null; brief_source?: string;
};
export type ExportScene = {
 script_version_id:string;position:number;description:string;visual_prompt:string;narration:string;source:string;
};
export type ExportDocument = {
 versionId:string;versionNumber:number;createdAt:string;content:string;source:string;
 snapshot:ExportSnapshot;scenes:ExportScene[];
};
export type ExportFormat = "txt"|"md";
export function sourceLabel(source:string) {
 return ({manual:"Ручной ввод",test:"Тестовый шаблон",yandex:"YandexGPT",unknown:"Не зафиксирован (старая версия)"} as Record<string,string>)[source] ?? "Неизвестный источник";
}
function fenced(text:string) {
 // A longer fence keeps user-supplied Markdown/HTML inside a literal text block.
 const runs=text.match(/`+/g) ?? [];
 const fence="`".repeat(Math.max(3,...runs.map(run=>run.length+1)));
 return fence+"text\n"+text+"\n"+fence;
}
export function exportText(document:ExportDocument,format:ExportFormat):string {
 if(document.scenes.some(scene=>scene.script_version_id!==document.versionId)) throw new Error("Scene version mismatch");
 const scenes=[...document.scenes].sort((a,b)=>a.position-b.position);
 if(new Set(scenes.map(scene=>scene.position)).size!==scenes.length) throw new Error("Duplicate scene position");
 const heading=(level:number,text:string)=>format==="md" ? "#".repeat(level)+" "+text : text;
 const block=(text:string)=>format==="md" ? fenced(text) : text;
 const settings=document.snapshot;
 const channel=channelSnapshot(settings.channel);
 const metadata=[
  "Название: "+settings.title,"Тема: "+settings.topic,"Жанр: "+settings.genre,"Стиль: "+settings.style,
  "Язык: "+(settings.language==="ru"?"Русский":settings.language==="en"?"Английский":settings.language),
  "Целевая длительность: "+settings.target_duration_seconds+" сек.",
  "Версия: "+document.versionNumber,"ID версии: "+document.versionId,
  "Создана: "+document.createdAt,"Источник сценария: "+sourceLabel(document.source),
  ...(settings.brief_source ? ["Источник замысла: "+sourceLabel(settings.brief_source)] : []),
  ...(channel ? ["Требования канала на момент создания ролика:\n"+channelSummary(channel)] : []),
 ].join("\n");
 const parts=[
  heading(1,"ScenePilot — версия "+document.versionNumber),
  "Экспорт сохранённых материалов. Несохранённые правки не включены.",
  heading(2,"Настройки на момент сохранения сценария"),block(metadata),
  heading(2,"Сценарий"),block(document.content),
  heading(2,"Сцены версии "+document.versionNumber),
 ];
 if(!scenes.length) parts.push("Сохранённых сцен для этой версии нет.");
 for(const scene of scenes) parts.push(
  heading(3,"Сцена "+scene.position),"Источник: "+sourceLabel(scene.source),
  heading(4,"Описание кадра"),block(scene.description),
  heading(4,"Визуальный промпт"),block(scene.visual_prompt),
  heading(4,"Текст озвучки"),block(scene.narration),
 );
 return parts.join("\n\n")+"\n";
}
export function exportFilename(document:ExportDocument,format:ExportFormat) {
 return "scenepilot-v"+document.versionNumber+"-"+document.versionId.replace(/[^a-zA-Z0-9]/g,"").slice(0,8)+"."+format;
}
