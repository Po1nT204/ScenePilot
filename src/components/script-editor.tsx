"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveScript } from "@/app/projects/[id]/scripts/actions";
import { scriptLimit, type ScriptState } from "@/lib/scripts/validation";

export function ScriptEditor({ projectId, initial, versionNumber }: { projectId: string; initial: string; versionNumber?: number }) {
 const [content, setContent] = useState(initial);
 const [state, action, pending] = useActionState(saveScript.bind(null, projectId), { message: "" } as ScriptState);
 const router = useRouter();
 const handled = useRef<string | undefined>(undefined);
 const dirty = content !== initial && !state.savedId;
 useEffect(() => {
  if (!state.savedId || handled.current === state.savedId) return;
  handled.current = state.savedId;
  router.replace(`/projects/${projectId}/scripts?version=${state.savedId}&saved=1`);
 }, [state.savedId, projectId, router]);
 useEffect(() => {
  if (!dirty && !pending) return;
  const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
  const click = (event: MouseEvent) => {
   const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
   if (link && !window.confirm(pending ? "Сохранение ещё выполняется. Покинуть страницу?" : "Есть несохранённый текст. Покинуть страницу и потерять изменения?")) {
    event.preventDefault(); event.stopPropagation();
   }
  };
  window.addEventListener("beforeunload", beforeUnload);
  document.addEventListener("click", click, true);
  return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
 }, [dirty, pending]);
 return <form action={action} className="auth-form project-form">
  <p>{versionNumber ? `Открыта версия ${versionNumber}. Сохранение создаст новую версию.` : "Введите первый сценарий. Генерация будет добавлена следующим шагом."}</p>
  <fieldset disabled={pending || !!state.savedId}>
   <label htmlFor="script-content">Текст сценария</label>
   <textarea id="script-content" name="content" rows={18} required maxLength={scriptLimit} value={content} onChange={event => setContent(event.target.value)} aria-describedby="script-hint" />
   <p id="script-hint" className="field-hint">{content.length} / {scriptLimit} символов. {dirty ? "Есть несохранённые изменения." : ""} Черновик автоматически не сохраняется.</p>
   <button className="button" type="submit" disabled={!content.trim() || content.trim() === initial.trim()}>{pending ? "Сохраняем…" : "Сохранить новую версию"}</button>
  </fieldset>
  <p className="form-message" role="status">{state.message}</p>
 </form>;
}
