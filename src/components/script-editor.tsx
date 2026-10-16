"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveScript } from "@/app/projects/[id]/scripts/actions";
import { generateScriptExample } from "@/app/projects/[id]/scripts/generate";
import { scriptLimit, type ScriptState } from "@/lib/scripts/validation";
import {NarrationMeter} from "./narration-meter";
import {supportsFullGeneration,longGenerationMessage} from "@/lib/duration";
import {sourceLabel} from "@/lib/export";

export function ScriptEditor({ projectId, initial, versionNumber, initialSource, yandexEnabled, targetDuration, versionDuration }: { projectId: string; initial: string; versionNumber?: number; initialSource:string; yandexEnabled:boolean; targetDuration:number; versionDuration?:number }) {
 const [content, setContent] = useState(initial);
 const [source,setSource] = useState(initialSource);
 const [generating, setGenerating] = useState(false);
 const [generationMessage, setGenerationMessage] = useState("");
 const generationLock = useRef(false);
 const [state, action, pending] = useActionState(saveScript.bind(null, projectId), { message: "" } as ScriptState);
 const router = useRouter();
 const handled = useRef<string | undefined>(undefined);
 const dirty = content !== initial && !state.savedId;
 const busy = pending || generating;
 async function generate(mode: "test" | "yandex") {
  if (generationLock.current || pending || state.savedId) return;
  if (mode === "yandex" && !supportsFullGeneration(targetDuration)) {setGenerationMessage(longGenerationMessage);return;}
  if (mode === "yandex" && !window.confirm("Отправить настройки проекта и сохранённые требования канала в Yandex AI Studio? Это платный запрос, максимум 2000 токенов ответа. Новый результат заменит текст редактора; сохранённые версии останутся.")) return;
  if (mode === "test" && content.trim() && !window.confirm("Заменить текст в редакторе тестовым примером? Несохранённые правки будут потеряны. Сохранённые версии останутся без изменений.")) return;
  generationLock.current = true;
  setGenerating(true);
  setGenerationMessage(mode === "yandex" ? "YandexGPT пишет сценарий. Ожидание — до 45 секунд…" : "Готовим тестовый пример…");
  try {
   const result = await generateScriptExample(projectId,mode);
   if (result.error !== undefined) setGenerationMessage(result.error);
   else {
    setContent(result.content);
    setSource(mode);
    setGenerationMessage(`${mode === "test" ? "Тестовый пример" : "Сценарий YandexGPT"} готов, но ещё не сохранён. Отредактируйте и сохраните новую версию.${result.tokens !== undefined ? ` Всего токенов: ${result.tokens}.` : ""}`);
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
 return <form action={action} className="auth-form project-form material-editor">
  <div className="editor-actions" aria-label="Действия со сценарием">
   <button className="button" type="submit" disabled={busy || !!state.savedId || !content.trim() || content.trim() === initial.trim()}>{pending ? "Сохраняем…" : "Сохранить новую версию"}</button>
   <button className="text-button" type="button" onClick={() => generate("yandex")} disabled={!yandexEnabled || !supportsFullGeneration(targetDuration) || busy || !!state.savedId}>YandexGPT · платно</button>
   <button className="text-button" type="button" onClick={() => generate("test")} disabled={busy || !!state.savedId}>Тестовый пример · бесплатно</button>
  </div>
  {!yandexEnabled && <p className="editor-note">YandexGPT выключен или не настроен.</p>}
  {!supportsFullGeneration(targetDuration) && <p className="editor-note">Для цели свыше 5 минут генерация сценария Yandex пока недоступна. Можно ввести текст вручную.</p>}
  <p className="form-message" role="status">{generationMessage}</p>
  <p className="form-message" role="status">{state.message}</p>
  <div className="editor-meta">
   <p role="status">{pending ? "Сохраняем…" : generating ? "Генерация…" : state.savedId ? "Версия сохранена" : dirty ? "Есть несохранённые изменения" : versionNumber ? `Версия ${versionNumber} · Сохранено` : "Новый сценарий · Не сохранён"}</p>
   <p>Источник: {sourceLabel(source)}</p>
  </div>
  <fieldset disabled={busy || !!state.savedId}>
   <input type="hidden" name="source" value={source} />
   <label htmlFor="script-content">Текст сценария</label>
   <textarea id="script-content" name="content" rows={18} required maxLength={scriptLimit} value={content} onChange={event => setContent(event.target.value)} aria-describedby="script-hint" />
   <p id="script-hint" className="editor-note">{content.length} / {scriptLimit} символов · Без автосохранения</p>
   {versionDuration !== undefined && versionDuration !== targetDuration && <p className="editor-note">Цель открытой версии: {versionDuration} сек. Для новой версии и оценки: {targetDuration} сек.</p>}
   <NarrationMeter text={content} targetSeconds={targetDuration} targetLabel="Цель новой версии" disabled={busy || !!state.savedId} />
  </fieldset>
  <details className="editor-help">
   <summary>О версиях и генерации</summary>
   <p>Сохранение создаёт новую версию с текущими настройками проекта. Старые тексты и снимки настроек не меняются. Черновик автоматически не сохраняется.</p>
   <p>Тестовый пример — бесплатный шаблон. YandexGPT — отдельный платный запрос с подтверждением; сохранение не вызывает модель повторно. Подключение описано в README.</p>
   <p>Генерация заменяет текст редактора после подтверждения. Ручные правки сохраняют источник исходного материала.</p>
  </details>
 </form>;
}
