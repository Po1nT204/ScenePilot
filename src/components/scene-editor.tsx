"use client";
import { useEffect, useId, useRef, useState } from "react";
import { generateSceneExamples, saveScenes, readSavedScenes } from "@/app/projects/[id]/scenes/actions";
import { addScene, moveScene, removeScene, stableSceneEditsPayload, type SceneEdit, type EditorScene } from "@/lib/scene-editing";
import Link from 'next/link';
import { sourceLabel } from "@/lib/export";
import {NarrationMeter} from "./narration-meter";
import {supportsFullGeneration,longGenerationMessage,sceneGenerationOptions} from "@/lib/duration";

import { SceneImport } from './scene-import';
import { sameSceneText } from '@/lib/scene-save';

const labels = { description: "Описание эпизода", visual_prompt: "Визуальный промпт эпизода", narration: "Текст озвучки" };
const signature = (scenes: SceneEdit[]) => JSON.stringify(scenes.map(({id,description,visual_prompt,narration,source}) => ({id,description,visual_prompt,narration,source})));

export function SceneEditor({projectId,versionId,initial,yandexEnabled,scriptContent,targetDuration,initialPace}: {projectId:string;versionId:string;initial:SceneEdit[];yandexEnabled:boolean;scriptContent:string;targetDuration:number;initialPace?:number}) {
 const [scenes,setScenes] = useState<EditorScene[]>(() => initial.map((scene,index) => ({...scene,key:`saved-${index}`})));
 const [baseline,setBaseline] = useState(() => signature(initial));
 const [busy,setBusy] = useState(false);
 const [message,setMessage] = useState("");
 const lock = useRef(false);
 const formId = useId();
 const dirty = signature(scenes) !== baseline;
 const valid = stableSceneEditsPayload(scenes) !== null;
 const [confirmedDeleteIds,setConfirmedDeleteIds] = useState<string[]>([]);
 const hasShots = initial.some(scene => (scene.shot_count ?? 0)>0) || scenes.some(scene=>(scene.shot_count ?? 0)>0);

 useEffect(() => {
  if (!dirty && !busy) return;
  const unload = (e: BeforeUnloadEvent) => e.preventDefault();
  const click = (e: MouseEvent) => {
   if (e.target instanceof Element && e.target.closest("a[href]") && !window.confirm("Есть несохранённые изменения или незавершённый запрос. Покинуть страницу?")) { e.preventDefault(); e.stopPropagation(); }
  };
  window.addEventListener("beforeunload",unload); document.addEventListener("click",click,true);
  return () => {window.removeEventListener("beforeunload",unload);document.removeEventListener("click",click,true);};
 },[dirty,busy]);

 function focus(id: string) { requestAnimationFrame(() => document.getElementById(id)?.focus()); }
 function add() {
  if (lock.current || scenes.length >= 12) return;
  const key = crypto.randomUUID();
  setScenes(previous => addScene(previous,key));
  setMessage("Добавлена ручная сцена. Заполните три поля и сохраните набор.");
  focus(`scene-${key}-description`);
 }
 function move(key: string, direction: -1 | 1) {
  if (lock.current) return;
  const next = moveScene(scenes,key,direction);
  setScenes(next);
  setMessage(`Сцена перемещена на позицию ${next.findIndex(scene => scene.key === key)+1}. Порядок ещё не сохранён.`);
  focus(`scene-${key}-heading`);
 }
 function remove(key: string, index: number) {
  const scene=scenes[index];
  if (lock.current || !window.confirm(`Удалить сцену ${index+1} из редактора? ${(scene.shot_count ?? 0)>0 ? `Вместе с ней будут удалены ${scene.shot_count} сохранённых кадров без восстановления. ` : ''}Сохранённый набор изменится только после нажатия «Сохранить сцены».`)) return;
  if(scene.id && (scene.shot_count ?? 0)>0) setConfirmedDeleteIds(previous=>[...previous,scene.id!]);
  const next = removeScene(scenes,key);
  setScenes(next); setMessage("Сцена удалена из редактора. Сохраните изменения, чтобы обновить набор этой версии.");
  const neighbor = next[Math.min(index,next.length-1)];
  focus(neighbor ? `scene-${neighbor.key}-heading` : "add-scene");
 }

 function downloadDraft() {
  const payload = scenes.map(({description,visual_prompt,narration}) => ({description,visual_prompt,narration}));
  const url=URL.createObjectURL(new Blob([JSON.stringify({scenes:payload},null,2)],{type:'application/json'}));
  const link=document.createElement('a'); link.href=url; link.download='scenes-draft.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function verifySaved() {
  if(lock.current) return; lock.current=true; setBusy(true);
  try {
   const result=await readSavedScenes(projectId,versionId), payload=stableSceneEditsPayload(scenes);
   if(result.error) setMessage(result.error);
   else if(payload && sameSceneText(payload,result.scenes!)) {
    setScenes(scenes.map((scene,i)=>({...scene,...result.scenes![i]}))); setBaseline(signature(result.scenes!)); setConfirmedDeleteIds([]);
    setMessage('Проверено чтением: все текущие сцены уже сохранены. Повторная запись не выполнялась.');
   } else setMessage('В базе другой набор сцен. Ваш черновик оставлен. Скачайте его перед обновлением страницы; запись не выполнялась.');
  } catch {setMessage('Не удалось проверить сохранение. Черновик оставлен.');}
  finally {lock.current=false;setBusy(false);}
 }
 function importScenes(imported:SceneEdit[]) {
  if(lock.current || hasShots) return;
  if(scenes.length && !window.confirm('Заменить черновик импортированными сценами? Сохранённый набор изменится только после сохранения.')) return;
  setScenes(imported.map(scene=>({...scene,key:crypto.randomUUID()})));setConfirmedDeleteIds([]);
  setMessage('Сцены вставлены как внешний ручной материал. Проверьте озвучку и нажмите «Сохранить сцены».');
 }
 async function run(mode:"test"|"yandex"|"save") {
  if(lock.current) return;
  if(mode !== 'save' && hasShots) {setMessage('У сцен есть кадры. Редактируйте эпизоды вручную; замена всего набора генерацией недоступна.');return;}
  if(mode === "yandex" && !supportsFullGeneration(targetDuration)) {setMessage(longGenerationMessage);return;}
  if(mode === "save" && (!dirty || !valid)) return;
  if (mode === "save" && !scenes.length && !window.confirm("Удалить все сохранённые сцены этой версии? Сценарий и другие версии останутся без изменений. Истории сцен для восстановления нет.")) return;
  if (mode === "yandex" && !window.confirm(`Отправить сохранённую версию сценария в Yandex? Это платный запрос до ${sceneGenerationOptions(scriptContent).maxTokens} токенов ответа. Озвучка должна сохраниться дословно; результат заменит редактор после проверки.`)) return;
  if (mode === "test" && scenes.length && !window.confirm("Заменить текущий текст сцен тестовым набором? Сохранённый набор изменится только после нажатия «Сохранить сцены».")) return;
  lock.current = true; setBusy(true); setMessage(mode === "yandex" ? `YandexGPT создаёт сцены. Ожидание — до ${sceneGenerationOptions(scriptContent).timeoutMs/1000} секунд…` : "Выполняем запрос…");
  try {
   if(mode !== "save") {
    const result = await generateSceneExamples(projectId,versionId,mode);
    if(result.scenes) {
     setScenes(result.scenes.map(scene => ({...scene,source:mode,key:crypto.randomUUID()})));
     setMessage(`${mode === "yandex" ? "Сцены YandexGPT" : "Тестовый набор"} готовы. Проверьте и сохраните сцены.${result.tokens !== undefined ? ` Всего токенов: ${result.tokens}.` : ""}`);
    } else setMessage(result.error);
   } else {
    const payload = stableSceneEditsPayload(scenes)!;
    const result = await saveScenes(projectId,versionId,payload,confirmedDeleteIds);
    if(result.error) setMessage(result.error);
    else {
     setScenes(scenes.map((scene,index) => ({...scene,...result.scenes![index]})));
     setConfirmedDeleteIds([]);
     setBaseline(signature(result.scenes!));
     setMessage(scenes.length ? "Все сцены и их порядок сохранены для этой версии." : "Сцены этой версии удалены. Сценарий сохранён.");
    }
   }
  } catch {setMessage("Запрос не завершён. Текст остаётся в редакторе; проверьте соединение.");}
  finally {lock.current=false;setBusy(false);}
 }

 return <div className="scene-workspace material-editor">
  <div className="scene-toolbar editor-actions" aria-label="Действия со сценами">
   <button className="button" form={formId} type="submit" disabled={busy || !dirty || !valid}>{busy ? "Выполняем запрос…" : "Сохранить сцены"}</button>
   <button type="button" id="add-scene" className="text-button" disabled={busy || scenes.length >= 12} onClick={add}>Добавить сцену</button>
   <button type="button" className="text-button" disabled={busy || hasShots || !yandexEnabled || !supportsFullGeneration(targetDuration)} onClick={() => run("yandex")}>Сцены YandexGPT · платно</button>
  </div>
  <details className="editor-help"><summary>Черновик и дополнительные действия</summary><div className="scene-toolbar">
   <button type="button" className="text-button" disabled={busy || hasShots} onClick={() => run("test")}>Тестовые сцены · бесплатно</button>
   <button type="button" className="text-button" onClick={() => void verifySaved()} disabled={busy}>Проверить сохранение · без записи</button>
   <button type="button" className="text-button" onClick={downloadDraft} disabled={busy || !scenes.length}>Скачать черновик сцен</button>
  </div></details>
  <SceneImport disabled={busy || hasShots} onImport={importScenes} />
  {!yandexEnabled && <p className="editor-note">YandexGPT выключен или не настроен.</p>}
  {hasShots && <p className="editor-note">У эпизодов есть кадры. Генерация замены отключена; ручные правки и порядок доступны.</p>}
  {!supportsFullGeneration(targetDuration) && <p className="editor-note">Для цели свыше 5 минут сцены Yandex пока недоступны. Можно добавить их вручную или использовать бесплатное разбиение.</p>}
  <p className="form-message" role="status">{message}</p>
  <p className="editor-note" role="status">{scenes.length} / 12 сцен · {dirty ? "Есть несохранённые изменения" : scenes.length ? "Сохранено" : "Нет сохранённых сцен"} · Без автосохранения</p>
  <NarrationMeter text={scenes.map(scene=>scene.narration).join("\n")} sourceText={scriptContent} sceneCount={scenes.length} targetSeconds={targetDuration} targetLabel="Цель сохранённой версии" initialPace={initialPace} disabled={busy} />
  {!scenes.length && <p>{dirty ? "Редактор пуст. Сохранение удалит прежний набор сцен этой версии." : "Сцен пока нет. Добавьте первую сцену или подготовьте тестовый набор по сценарию."}</p>}
  <form id={formId} onSubmit={e => {e.preventDefault();void run("save");}} className="auth-form">
   <fieldset disabled={busy}>
    <div className="scene-grid">{scenes.map((scene,index) => <section className="scene-card project-form" key={scene.key} aria-labelledby={`scene-${scene.key}-heading`}>
     <div className="scene-card-heading">
      <h2 className="eyebrow" id={`scene-${scene.key}-heading`} tabIndex={-1}>СЦЕНА {String(index+1).padStart(2,"0")}</h2>
      <p className="editor-note">Источник: {sourceLabel(scene.source)}</p>
     </div>
     <div className="scene-card-actions">
      <button type="button" className="text-button" disabled={index === 0} aria-label={`Переместить сцену ${index+1} вверх`} onClick={() => move(scene.key,-1)}>↑ Выше</button>
      <button type="button" className="text-button" disabled={index === scenes.length-1} aria-label={`Переместить сцену ${index+1} вниз`} onClick={() => move(scene.key,1)}>↓ Ниже</button>
      <button type="button" className="danger-button" aria-label={`Удалить сцену ${index+1}`} onClick={() => remove(scene.key,index)}>Удалить</button>
     </div>
     {scene.id && !dirty && !busy ? <Link href={`/projects/${projectId}/scenes/${scene.id}?version=${versionId}`}>Кадры эпизода ({scene.shot_count ?? 0}) →</Link> : <p className="editor-note">Сохраните сцены, чтобы открыть кадры эпизода.</p>}
     {(Object.keys(labels) as (keyof typeof labels)[]).map(key => <div key={key}>
      <label htmlFor={`scene-${scene.key}-${key}`}>{labels[key]}</label>
      <textarea id={`scene-${scene.key}-${key}`} required maxLength={2000} rows={key === "narration" ? 7 : 4} value={scene[key]} onChange={e => {setScenes(previous=>previous.map(item=>item.key===scene.key?{...item,[key]:e.target.value}:item));setMessage("");}} />
     </div>)}
    </section>)}</div>
    {dirty && !valid && <p className="field-hint">Перед сохранением заполните все три поля каждой сцены: от 1 до 2000 символов.</p>}
    {scenes.length > 2 && <button className="button" disabled={!dirty || !valid} type="submit">{busy ? "Выполняем запрос…" : "Сохранить сцены"}</button>}
   </fieldset>
  </form>
  <details className="editor-help">
   <summary>О сценах и сохранении</summary>
   <p>Добавление, порядок и удаление меняют черновик. «Сохранить сцены» применяет весь набор только к выбранной версии. Новая версия сценария получает отдельный набор сцен. Истории правок сцен нет.</p>
   <p>Сцена — крупный эпизод: описание, общий визуальный промпт и озвучка до 2000 символов на поле. Внутри сохранённой сцены можно составить отдельные кадры. Источник и кадры сохраняются при правке и перестановке эпизода.</p>
   <p>Тестовые сцены — бесплатное механическое разбиение. YandexGPT — отдельный платный запрос с подтверждением. Сохранение не вызывает модель повторно. Подключение описано в README.</p>
  </details>
 </div>;
}
