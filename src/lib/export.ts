import { channelSnapshot, channelSummary, type ChannelProfile } from "./channel";
import { publicationPayload, type PublicationDraft } from "./publication";
import type { SavedShot } from './shots';
export type ExportSnapshot = {
 title:string;topic:string;genre:string;style:string;language:string;target_duration_seconds:number;
 channel?: ChannelProfile | null; brief_source?: string; narration_pace?:number;
};
export type ExportScene = {
 id?:string;script_version_id:string;position:number;description:string;visual_prompt:string;narration:string;source:string;
};
export type ExportDocument = {
 versionId:string;versionNumber:number;createdAt:string;content:string;source:string;
 snapshot:ExportSnapshot;scenes:ExportScene[];
 shots?:SavedShot[];
 shotPlans?:{scene_id:string;script_version_id:string;narration_snapshot:string}[];
 publication?: (PublicationDraft & {script_version_id:string}) | null;
};
export type ExportFormat = "txt"|"md";
export type ExportMode = "narration"|"visuals"|"shots"|"archive";
export function sourceLabel(source:string) {
 return ({manual:"Ручной ввод",test:"Тестовый шаблон",yandex:"YandexGPT",unknown:"Не зафиксирован (старая версия)"} as Record<string,string>)[source] ?? "Неизвестный источник";
}
function fenced(text:string) {
 // A longer fence keeps user-supplied Markdown/HTML inside a literal text block.
 const runs=text.match(/`+/g) ?? [];
 const fence="`".repeat(Math.max(3,...runs.map(run=>run.length+1)));
 return fence+"text\n"+text+"\n"+fence;
}
export function exportScenes(document:ExportDocument):ExportScene[] {
 if(document.scenes.some(scene=>scene.script_version_id!==document.versionId)) throw new Error("Scene version mismatch");
 if(document.publication && document.publication.script_version_id!==document.versionId) throw new Error("Publication version mismatch");
 const publication = document.publication ? publicationPayload(document.publication) : null;
 if(document.publication && !publication) throw new Error("Invalid publication material");
 const scenes=[...document.scenes].sort((a,b)=>a.position-b.position);
 if(new Set(scenes.map(scene=>scene.position)).size!==scenes.length) throw new Error("Duplicate scene position");
 return scenes;
}
export function exportShots(document:ExportDocument):SavedShot[] {
 const scenes=exportScenes(document);
 const positions=new Map(scenes.filter(scene=>scene.id).map(scene=>[scene.id,scene.position]));
 if(positions.size!==scenes.filter(scene=>scene.id).length) throw new Error('Duplicate scene id');
 const shots=document.shots ?? [];
 if(shots.some(shot=>shot.script_version_id!==document.versionId || !positions.has(shot.scene_id))) throw new Error('Shot version or scene mismatch');
 if(new Set(shots.map(shot=>shot.id)).size!==shots.length || new Set(shots.map(shot=>`${shot.scene_id}:${shot.position}`)).size!==shots.length) throw new Error('Duplicate shot');
 if(document.shotPlans?.some(plan=>plan.script_version_id!==document.versionId || !positions.has(plan.scene_id))) throw new Error('Shot plan version or scene mismatch');
 return [...shots].sort((a,b)=>positions.get(a.scene_id)!-positions.get(b.scene_id)! || a.position-b.position);
}
export function exportText(document:ExportDocument,format:ExportFormat,mode:ExportMode="archive"):string {
 const scenes=exportScenes(document);
 const shots=exportShots(document);
 // Clean modes preserve the stored text verbatim, including whitespace and Markdown.
 if(mode==="narration") return document.content;
 if(mode==="visuals") return scenes.map(scene=>scene.visual_prompt).join("\n\n---\n\n");
 if(mode==="shots") return shots.map(shot=>shot.visual_prompt).join("\n\n---\n\n");
 const publication = document.publication ? publicationPayload(document.publication) : null;
 const heading=(level:number,text:string)=>format==="md" ? "#".repeat(level)+" "+text : text;
 const block=(text:string)=>format==="md" ? fenced(text) : text;
 const settings=document.snapshot;
 const channel=channelSnapshot(settings.channel);
 const metadata=[
  "Название: "+settings.title,"Тема: "+settings.topic,"Жанр: "+settings.genre,"Стиль: "+settings.style,
  "Язык: "+(settings.language==="ru"?"Русский":settings.language==="en"?"Английский":settings.language),
  "Целевая длительность: "+settings.target_duration_seconds+" сек.",
  "Темп озвучки: "+(settings.narration_pace===undefined ? "не зафиксирован" : settings.narration_pace+" слов/мин"),
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
 for(const scene of scenes) {
  parts.push(
  heading(3,"Сцена "+scene.position),"Источник: "+sourceLabel(scene.source),
  heading(4,"Описание кадра"),block(scene.description),
  heading(4,"Визуальный промпт"),block(scene.visual_prompt),
  heading(4,"Текст озвучки"),block(scene.narration),
  );
  const sceneShots=shots.filter(shot=>shot.scene_id===scene.id);
  if(!sceneShots.length) parts.push('Сохранённых кадров эпизода нет.');
  const plan=document.shotPlans?.find(plan=>plan.scene_id===scene.id);
  if(sceneShots.length && (!plan || plan.narration_snapshot!==scene.narration)) parts.push('План кадров требует сверки с озвучкой эпизода.');
  for(const shot of sceneShots) parts.push(heading(4,`Кадр ${scene.position}.${shot.position}`),`ID кадра: ${shot.id}\nID эпизода: ${shot.scene_id}\nИсточник: ${sourceLabel(shot.source)}\nПримерная длительность: ${shot.duration_seconds} сек.`,heading(5,'Фрагмент озвучки'),block(shot.narration_excerpt),heading(5,'Действие'),block(shot.action),heading(5,'Визуальный промпт кадра'),block(shot.visual_prompt));
 }
 parts.push(heading(2,"Материалы публикации версии "+document.versionNumber));
 if(publication) {
  parts.push("Источник: "+sourceLabel(publication.source),heading(3,"Выбранный заголовок"),block(publication.title),heading(3,"Описание ролика"),block(publication.description));
  if(publication.titles.length) parts.push(heading(3,"Варианты заголовка"),block(publication.titles.map((title,index)=>`${index+1}. ${title}`).join("\n")));
 } else parts.push("Материалы публикации для этой версии не сохранены.");
 return parts.join("\n\n")+"\n";
}
export function exportFilename(document:ExportDocument,format:ExportFormat,mode:ExportMode="archive") {
 return "scenepilot-v"+document.versionNumber+"-"+document.versionId.replace(/[^a-zA-Z0-9]/g,"").slice(0,8)+(mode==="archive"?"":"-"+mode)+"."+format;
}
