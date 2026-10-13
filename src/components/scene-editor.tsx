"use client";
import { useEffect, useRef, useState } from "react";
import { generateSceneExamples, saveScenes } from "@/app/projects/[id]/scenes/actions";
import { type SceneDraft, validScenes } from "@/lib/scenes";
const labels = { description: "Описание кадра", visual_prompt: "Визуальный промпт", narration: "Текст озвучки" };
export function SceneEditor({projectId,versionId,initial,initialSource,yandexEnabled}: {projectId:string;versionId:string;initial:SceneDraft[];initialSource:"test"|"yandex";yandexEnabled:boolean}) {
 const [scenes,setScenes] = useState(initial);
 const [source,setSource] = useState(initialSource);
 const [baseline,setBaseline] = useState(JSON.stringify({scenes:initial,source:initialSource}));
 const [busy,setBusy] = useState(false);
 const [message,setMessage] = useState("");
 const lock = useRef(false);
 const dirty = JSON.stringify({scenes,source}) !== baseline;
 useEffect(() => {
  if (!dirty && !busy) return;
  const unload = (e: BeforeUnloadEvent) => e.preventDefault();
  const click = (e: MouseEvent) => {
   if (e.target instanceof Element && e.target.closest("a[href]") && !window.confirm("Есть несохранённые изменения или незавершённый запрос. Покинуть страницу?")) { e.preventDefault(); e.stopPropagation(); }
  };
  window.addEventListener("beforeunload",unload); document.addEventListener("click",click,true);
  return () => {window.removeEventListener("beforeunload",unload);document.removeEventListener("click",click,true);};
 },[dirty,busy]);
 async function run(mode:"test"|"yandex"|"save") {
  const generate = mode !== "save";
  if(lock.current) return;
  if (mode === "yandex" && !window.confirm("Отправить сохранённую версию сценария в Yandex? Это платный запрос до 4000 токенов ответа. Результат заменит редактор сцен, но сохранённый набор изменится только после сохранения.")) return;
  if (mode === "test" && scenes.length && !window.confirm("Заменить текущий текст сцен тестовым набором? Сохранённый набор изменится только после нажатия «Сохранить сцены».")) return;
  lock.current = true; setBusy(true); setMessage(mode === "yandex" ? "YandexGPT создаёт сцены. Ожидание — до 45 секунд…" : "Выполняем запрос…");
  try {
   if(generate) {
    const result = await generateSceneExamples(projectId,versionId,mode as "test"|"yandex");
    if(result.scenes) {setScenes(result.scenes);setSource(mode as "test"|"yandex");setMessage(`${mode === "yandex" ? "Сцены YandexGPT" : "Тестовый набор"} готовы. Проверьте и сохраните сцены.${result.tokens !== undefined ? ` Всего токенов: ${result.tokens}.` : ""}`);}
    else setMessage(result.error);
   } else {
    const result = await saveScenes(projectId,versionId,scenes,source);
    if(result.error) setMessage(result.error);
    else {setBaseline(JSON.stringify({scenes,source}));setMessage("Все сцены сохранены для этой версии.");}
   }
  } catch {setMessage("Запрос не завершён. Текст остаётся в редакторе; проверьте соединение.");}
  finally {lock.current=false;setBusy(false);}
 }
 return <div className="scene-workspace">
  <div className="success-notice"><strong>{scenes.length ? source === "yandex" ? "Источник сцен: YandexGPT" : "Источник сцен: тестовый шаблон" : "Подготовьте раскадровку сохранённой версии"}</strong><p>{source === "yandex" && scenes.length ? "Проверьте, что озвучка не потеряла смысл и события идут в нужном порядке. Ручная правка сохраняет отметку источника." : "Тестовая кнопка делит текст механически. YandexGPT предлагает смысловые сцены и визуальные промпты."}</p></div>
  <button className="button" disabled={busy || !yandexEnabled} onClick={() => run("yandex")}>Создать сцены с YandexGPT</button>{" "}
  <button className="text-button" disabled={busy} onClick={() => run("test")}>Подготовить тестовые сцены</button>
  {!yandexEnabled && <p>Yandex выключен или не настроен. Инструкция подключения — в README.</p>}
  <p role="status">{message}</p>
  <p>{scenes.length} сцен · {dirty ? "Есть несохранённые изменения" : "Нет несохранённых изменений"}</p>
  <form onSubmit={e => {e.preventDefault();void run("save");}} className="auth-form">
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
