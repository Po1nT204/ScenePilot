"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveScript } from "@/app/projects/[id]/scripts/actions";
import { generateScriptExample } from "@/app/projects/[id]/scripts/generate";
import { scriptLimit, type ScriptState } from "@/lib/scripts/validation";

export function ScriptEditor({ projectId, initial, versionNumber }: { projectId: string; initial: string; versionNumber?: number }) {
 const [content, setContent] = useState(initial);
 const [generating, setGenerating] = useState(false);
 const [generationMessage, setGenerationMessage] = useState("");
 const generationLock = useRef(false);
 const [state, action, pending] = useActionState(saveScript.bind(null, projectId), { message: "" } as ScriptState);
 const router = useRouter();
 const handled = useRef<string | undefined>(undefined);
 const dirty = content !== initial && !state.savedId;
 const busy = pending || generating;
 async function generate() {
  if (generationLock.current || pending || state.savedId) return;
  if (content.trim() && !window.confirm("Заменить текст в редакторе тестовым примером? Несохранённые правки будут потеряны. Сохранённые версии останутся без изменений.")) return;
  generationLock.current = true;
  setGenerating(true);
  setGenerationMessage("");
  try {
   const result = await generateScriptExample(projectId);
   if (result.error !== undefined) setGenerationMessage(result.error);
   else {
    setContent(result.content);
    setGenerationMessage("Тестовый пример готов, но ещё не сохранён. Отредактируйте его и сохраните новую версию.");
   }
  } catch {
   setGenerationMessage("Не удалось получить пример. Проверьте соединение и вход в аккаунт. Текст не изменён.");
  } finally {
   generationLock.current = false;
   setGenerating(false);
  }
 }
 useEffect(() => {
  if (!state.savedId || handled.current === state.savedId) return;
  handled.current = state.savedId;
  router.replace(`/projects/${projectId}/scripts?version=${state.savedId}&saved=1`);
 }, [state.savedId, projectId, router]);
 useEffect(() => {
  if (!dirty && !busy) return;
  const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
  const click = (event: MouseEvent) => {
   const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
   if (link && !window.confirm(busy ? "Запрос ещё выполняется. Покинуть страницу?" : "Есть несохранённый текст. Покинуть страницу и потерять изменения?")) {
    event.preventDefault(); event.stopPropagation();
   }
  };
  window.addEventListener("beforeunload", beforeUnload);
  document.addEventListener("click", click, true);
  return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
 }, [dirty, busy]);
 return <form action={action} className="auth-form project-form">
  <p>{versionNumber ? `Открыта версия ${versionNumber}. Сохранение создаст новую версию.` : "Введите первый сценарий или получите тестовый пример."}</p>
  <section aria-label="Тестовая генерация">
   <h2>Тестовый режим</h2>
   <p>Пример собирается из шаблона по текущим настройкам проекта. YandexGPT не подключён, платных запросов нет. Повторный запрос с теми же настройками даёт тот же текст.</p>
   <button className="button" type="button" onClick={generate} disabled={busy || !!state.savedId}>{generating ? "Готовим пример…" : "Получить тестовый пример"}</button>
   <p className="form-message" role="status">{generationMessage}</p>
  </section>
  <fieldset disabled={busy || !!state.savedId}>
   <label htmlFor="script-content">Текст сценария</label>
   <textarea id="script-content" name="content" rows={18} required maxLength={scriptLimit} value={content} onChange={event => setContent(event.target.value)} aria-describedby="script-hint" />
   <p id="script-hint" className="field-hint">{content.length} / {scriptLimit} символов. {dirty ? "Есть несохранённые изменения." : ""} Черновик автоматически не сохраняется.</p>
   <button className="button" type="submit" disabled={!content.trim() || content.trim() === initial.trim()}>{pending ? "Сохраняем…" : "Сохранить новую версию"}</button>
  </fieldset>
  <p className="form-message" role="status">{state.message}</p>
 </form>;
}
