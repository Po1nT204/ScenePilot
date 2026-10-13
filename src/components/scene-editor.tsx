"use client";
import { useEffect, useRef, useState } from "react";
import { generateSceneExamples, saveScenes } from "@/app/projects/[id]/scenes/actions";
import { type SceneDraft, validScenes } from "@/lib/scenes";
const labels = { description: "Описание кадра", visual_prompt: "Визуальный промпт", narration: "Текст озвучки" };
export function SceneEditor({projectId,versionId,initial}: {projectId:string;versionId:string;initial:SceneDraft[]}) {
 const [scenes,setScenes] = useState(initial);
 const [baseline,setBaseline] = useState(JSON.stringify(initial));
 const [busy,setBusy] = useState(false);
 const [message,setMessage] = useState("");
 const lock = useRef(false);
 const dirty = JSON.stringify(scenes) !== baseline;
 useEffect(() => {
  if (!dirty && !busy) return;
  const unload = (e: BeforeUnloadEvent) => e.preventDefault();
  const click = (e: MouseEvent) => {
   if (e.target instanceof Element && e.target.closest("a[href]") && !window.confirm("Есть несохранённые изменения или незавершённый запрос. Покинуть страницу?")) { e.preventDefault(); e.stopPropagation(); }
  };
  window.addEventListener("beforeunload",unload); document.addEventListener("click",click,true);
  return () => {window.removeEventListener("beforeunload",unload);document.removeEventListener("click",click,true);};
 },[dirty,busy]);
 async function run(generate: boolean) {
  if(lock.current) return;
  if (generate && scenes.length && !window.confirm("Заменить текущий текст сцен тестовым набором? Сохранённый набор изменится только после нажатия «Сохранить сцены».")) return;
  lock.current = true; setBusy(true); setMessage("");
  try {
   if(generate) {
    const result = await generateSceneExamples(projectId,versionId);
    if(result.scenes) {setScenes(result.scenes);setMessage("Тестовый набор готов. Отредактируйте и сохраните сцены.");}
    else setMessage(result.error);
   } else {
    const result = await saveScenes(projectId,versionId,scenes);
    if(result.error) setMessage(result.error);
    else {setBaseline(JSON.stringify(scenes));setMessage("Все сцены сохранены для этой версии.");}
   }
  } catch {setMessage("Запрос не завершён. Текст остаётся в редакторе; проверьте соединение.");}
  finally {lock.current=false;setBusy(false);}
 }
 return <div className="scene-workspace">
  <div className="success-notice"><strong>Тестовый режим · модель не вызывалась</strong><p>Сохранённый сценарий делится на фрагменты, а промпты создаются по шаблону. Это не смысловой анализ: проверьте границы сцен и уберите служебные инструкции из озвучки.</p></div>
  <button className="button" disabled={busy} onClick={() => run(true)}>{busy ? "Выполняем запрос…" : scenes.length ? "Заново подготовить тестовые сцены" : "Подготовить тестовые сцены"}</button>
  <p role="status">{message}</p>
  <p>{scenes.length} сцен · {dirty ? "Есть несохранённые изменения" : "Нет несохранённых изменений"}</p>
  <form onSubmit={e => {e.preventDefault();void run(false);}} className="auth-form">
   <fieldset disabled={busy}>
    <div className="scene-grid">{scenes.map((scene,index) => <section className="scene-card project-form" key={index}>
     <p className="eyebrow">СЦЕНА {String(index+1).padStart(2,"0")}</p>
     {Object.entries(labels).map(([key,label]) => <div key={key}><label htmlFor={`scene-${index}-${key}`}>{label}</label><textarea id={`scene-${index}-${key}`} required maxLength={2000} rows={key === "narration" ? 7 : 4} value={scene[key as keyof SceneDraft]} onChange={e => {setScenes(previous=>previous.map((item,i)=>i===index?{...item,[key]:e.target.value}:item));setMessage("");}} /></div>)}
    </section>)}</div>
    {!!scenes.length && <button className="button" disabled={!dirty || !validScenes(scenes)} type="submit">Сохранить сцены</button>}
   </fieldset>
  </form>
 </div>;
}
