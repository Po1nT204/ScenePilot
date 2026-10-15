"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { saveProject } from "@/app/projects/actions";
import { emptyProject, projectLimits, type ProjectState, type ProjectValues } from "@/lib/projects/validation";
import { IdeaAssistant } from "./idea-assistant";
import type { ChannelProfile } from "@/lib/channel";
import { sourceLabel } from "@/lib/export";
const labels = { title: "Название ролика", topic: "Тема и идея", genre: "Жанр", style: "Стиль" };
export function ProjectForm({ id = null, initial = emptyProject, navigationVersion, profile = null, profileRevision = null, yandexEnabled = false }: { id?: string | null; initial?: ProjectValues; navigationVersion?: string; profile?: ChannelProfile | null; profileRevision?: string | null; yandexEnabled?: boolean }) {
 const [state, action, pending] = useActionState(saveProject.bind(null, id), { message: "", values: initial } as ProjectState);
 const [values, setValues] = useState(initial);
 const [briefSource, setBriefSource] = useState("manual");
 const [generating, setGenerating] = useState(false);
 const change = (field: keyof ProjectValues, value: string) => setValues(previous => ({ ...previous, [field]: value }));
 return <form action={action} className="auth-form project-form">
  {!id && <>
    <input type="hidden" name="briefSource" value={briefSource} />
    <input type="hidden" name="profileRevision" value={profileRevision ?? ""} />
    <IdeaAssistant profile={profile} profileRevision={profileRevision} language={values.language} duration={values.duration} yandexEnabled={yandexEnabled} disabled={pending} onBusy={setGenerating} onApply={(idea, source) => {
      if ((values.title.trim() || values.topic.trim() || values.genre !== initial.genre || values.style !== initial.style) && !window.confirm("Заменить название, тему, жанр и стиль в форме выбранным вариантом? Ваши несохранённые правки этих полей будут заменены.")) return;
      setValues(previous => ({ ...previous, ...idea })); setBriefSource(source);
    }} />
    <h2>Настройки ролика</h2>
    <p className="field-hint">Источник замысла: {sourceLabel(briefSource)}. Ручные правки сохраняют эту отметку. Ролик появится после нажатия «Создать ролик».</p>
  </>}
  {navigationVersion && <input type="hidden" name="navigationVersion" value={navigationVersion} />}
  <fieldset disabled={pending || generating}>
   {(["title", "topic", "genre", "style"] as const).map((field) => <div key={field}>
    <label htmlFor={field}>{labels[field]}</label>
    {field === "topic" ? <textarea id={field} name={field} value={values[field]} onChange={e => change(field, e.target.value)} required maxLength={projectLimits[field]} rows={5} aria-invalid={!!state.errors?.[field]} aria-describedby={field + "-error"} />
     : <input id={field} name={field} value={values[field]} onChange={e => change(field, e.target.value)} required maxLength={projectLimits[field]} aria-invalid={!!state.errors?.[field]} aria-describedby={field + "-error"} />}
    <p id={field + "-error"} className="field-error">{state.errors?.[field]}</p>
   </div>)}
   <label htmlFor="language">Язык видео</label>
   <select id="language" name="language" value={values.language} onChange={e => change("language", e.target.value)} aria-invalid={!!state.errors?.language} aria-describedby="language-error"><option value="ru">Русский</option><option value="en">Английский</option></select>
   <p id="language-error" className="field-error">{state.errors?.language}</p>
   <label htmlFor="duration">Предполагаемая длительность, секунд</label>
   <input id="duration" name="duration" type="number" min={1} max={300} step={1} value={values.duration} onChange={e => change("duration", e.target.value)} required aria-invalid={!!state.errors?.duration} aria-describedby="duration-hint duration-error" />
   <p id="duration-hint" className="field-hint">От 1 до 300 секунд. Это ориентир для будущего сценария.</p>
   <p id="duration-error" className="field-error">{state.errors?.duration}</p>
   <button type="submit" className="button">{pending ? "Сохраняем…" : id ? "Сохранить изменения" : "Создать ролик"}</button>
  </fieldset>
  <p className="form-message" role="status">{state.message}</p>
  <p><Link className="text-link" href={id ? "/projects/" + id + (navigationVersion ? `?version=${navigationVersion}` : "") : "/projects"}>Отмена</Link></p>
 </form>;
}
