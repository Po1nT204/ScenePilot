"use client";
import { useEffect, useRef, useState } from "react";
import { generateSceneExamples, saveScenes } from "@/app/projects/[id]/scenes/actions";
import { addScene, moveScene, removeScene, sceneEditsPayload, type SceneEdit, type EditorScene } from "@/lib/scene-editing";
import { sourceLabel } from "@/lib/export";

const labels = { description: "Описание кадра", visual_prompt: "Визуальный промпт", narration: "Текст озвучки" };
const signature = (scenes: SceneEdit[]) => JSON.stringify(scenes.map(({description,visual_prompt,narration,source}) => ({description,visual_prompt,narration,source})));

export function SceneEditor({projectId,versionId,initial,yandexEnabled}: {projectId:string;versionId:string;initial:SceneEdit[];yandexEnabled:boolean}) {
 const [scenes,setScenes] = useState<EditorScene[]>(() => initial.map((scene,index) => ({...scene,key:`saved-${index}`})));
 const [baseline,setBaseline] = useState(() => signature(initial));
 const [busy,setBusy] = useState(false);
 const [message,setMessage] = useState("");
 const lock = useRef(false);
 const dirty = signature(scenes) !== baseline;
 const valid = sceneEditsPayload(scenes) !== null;

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
  if (lock.current || !window.confirm(`Удалить сцену ${index+1} из редактора? Её текст будет убран. Сохранённый набор изменится только после нажатия «Сохранить сцены».`)) return;
  const next = removeScene(scenes,key);
  setScenes(next); setMessage("Сцена удалена из редактора. Сохраните изменения, чтобы обновить набор этой версии.");
  const neighbor = next[Math.min(index,next.length-1)];
  focus(neighbor ? `scene-${neighbor.key}-heading` : "add-scene");
 }

 async function run(mode:"test"|"yandex"|"save") {
  if(lock.current) return;
  if(mode === "save" && (!dirty || !valid)) return;
  if (mode === "save" && !scenes.length && !window.confirm("Удалить все сохранённые сцены этой версии? Сценарий и другие версии останутся без изменений. Истории сцен для восстановления нет.")) return;
  if (mode === "yandex" && !window.confirm("Отправить сохранённую версию сценария в Yandex? Это платный запрос до 4000 токенов ответа. Результат заменит редактор сцен, но сохранённый набор изменится только после сохранения.")) return;
  if (mode === "test" && scenes.length && !window.confirm("Заменить текущий текст сцен тестовым набором? Сохранённый набор изменится только после нажатия «Сохранить сцены».")) return;
  lock.current = true; setBusy(true); setMessage(mode === "yandex" ? "YandexGPT создаёт сцены. Ожидание — до 45 секунд…" : "Выполняем запрос…");
  try {
   if(mode !== "save") {
    const result = await generateSceneExamples(projectId,versionId,mode);
    if(result.scenes) {
     setScenes(result.scenes.map(scene => ({...scene,source:mode,key:crypto.randomUUID()})));
     setMessage(`${mode === "yandex" ? "Сцены YandexGPT" : "Тестовый набор"} готовы. Проверьте и сохраните сцены.${result.tokens !== undefined ? ` Всего токенов: ${result.tokens}.` : ""}`);
    } else setMessage(result.error);
   } else {
    const payload = sceneEditsPayload(scenes)!;
    const result = await saveScenes(projectId,versionId,payload);
    if(result.error) setMessage(result.error);
    else {
     setScenes(scenes.map((scene,index) => ({...scene,...payload[index]})));
     setBaseline(signature(payload));
     setMessage(scenes.length ? "Все сцены и их порядок сохранены для этой версии." : "Сцены этой версии удалены. Сценарий сохранён.");
    }
   }
  } catch {setMessage("Запрос не завершён. Текст остаётся в редакторе; проверьте соединение.");}
  finally {lock.current=false;setBusy(false);}
 }

 return <div className="scene-workspace">
  <div className="success-notice"><strong>Раскадровка выбранной версии</strong><p>Добавляйте сцены вручную или получите набор генерацией. Источник указан на каждой карточке и сохраняется при правках и перестановке. Изменения применяются после сохранения.</p></div>
  <div className="scene-toolbar">
   <button type="button" id="add-scene" className="button" disabled={busy || scenes.length >= 12} onClick={add}>Добавить сцену</button>
   <button type="button" className="text-button" disabled={busy} onClick={() => run("test")}>Тестовые сцены · бесплатно</button>
   <button type="button" className="text-button" disabled={busy || !yandexEnabled} onClick={() => run("yandex")}>Сцены YandexGPT · платно</button>
  </div>
  {!yandexEnabled && <p className="field-hint">Yandex выключен или не настроен. Ручное создание и тестовые сцены доступны.</p>}
  <p role="status" aria-live="polite">{message}</p>
  <p>{scenes.length} из 12 сцен · {dirty ? "Есть несохранённые изменения" : "Нет несохранённых изменений"}</p>
  {!scenes.length && <p>{dirty ? "Редактор пуст. Сохранение удалит прежний набор сцен этой версии." : "Сцен пока нет. Добавьте первую сцену или подготовьте тестовый набор по сценарию."}</p>}
  <form onSubmit={e => {e.preventDefault();void run("save");}} className="auth-form">
   <fieldset disabled={busy}>
    <div className="scene-grid">{scenes.map((scene,index) => <section className="scene-card project-form" key={scene.key} aria-labelledby={`scene-${scene.key}-heading`}>
     <h2 className="eyebrow" id={`scene-${scene.key}-heading`} tabIndex={-1}>СЦЕНА {String(index+1).padStart(2,"0")}</h2>
     <p className="field-hint">Источник: {sourceLabel(scene.source)}</p>
     <div className="scene-card-actions">
      <button type="button" className="text-button" disabled={index === 0} aria-label={`Переместить сцену ${index+1} вверх`} onClick={() => move(scene.key,-1)}>↑ Выше</button>
      <button type="button" className="text-button" disabled={index === scenes.length-1} aria-label={`Переместить сцену ${index+1} вниз`} onClick={() => move(scene.key,1)}>↓ Ниже</button>
      <button type="button" className="danger-button" aria-label={`Удалить сцену ${index+1}`} onClick={() => remove(scene.key,index)}>Удалить</button>
     </div>
     {(Object.keys(labels) as (keyof typeof labels)[]).map(key => <div key={key}>
      <label htmlFor={`scene-${scene.key}-${key}`}>{labels[key]}</label>
      <textarea id={`scene-${scene.key}-${key}`} required maxLength={2000} rows={key === "narration" ? 7 : 4} value={scene[key]} onChange={e => {setScenes(previous=>previous.map(item=>item.key===scene.key?{...item,[key]:e.target.value}:item));setMessage("");}} />
     </div>)}
    </section>)}</div>
    {dirty && !valid && <p className="field-hint">Перед сохранением заполните все три поля каждой сцены: от 1 до 2000 символов.</p>}
    <button className="button" disabled={!dirty || !valid} type="submit">{busy ? "Выполняем запрос…" : "Сохранить сцены"}</button>
   </fieldset>
  </form>
 </div>;
}
