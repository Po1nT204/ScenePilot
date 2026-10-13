"use client";
import { useActionState } from "react";
import Link from "next/link";
import { saveProject } from "@/app/projects/actions";
import { emptyProject, projectLimits, type ProjectState, type ProjectValues } from "@/lib/projects/validation";
const labels = { title: "Название проекта", topic: "Тема и идея", genre: "Жанр", style: "Стиль" };
export function ProjectForm({ id = null, initial = emptyProject }: { id?: string | null; initial?: ProjectValues }) {
 const [state, action, pending] = useActionState(saveProject.bind(null, id), { message: "", values: initial } as ProjectState);
 const values = state.values ?? initial;
 return <form action={action} className="auth-form project-form">
  <fieldset disabled={pending}>
   {(["title", "topic", "genre", "style"] as const).map((field) => <div key={field}>
    <label htmlFor={field}>{labels[field]}</label>
    {field === "topic" ? <textarea id={field} name={field} defaultValue={values[field]} required maxLength={projectLimits[field]} rows={5} aria-invalid={!!state.errors?.[field]} aria-describedby={field + "-error"} />
     : <input id={field} name={field} defaultValue={values[field]} required maxLength={projectLimits[field]} aria-invalid={!!state.errors?.[field]} aria-describedby={field + "-error"} />}
    <p id={field + "-error"} className="field-error">{state.errors?.[field]}</p>
   </div>)}
   <label htmlFor="language">Язык видео</label>
   <select id="language" name="language" defaultValue={values.language} aria-invalid={!!state.errors?.language} aria-describedby="language-error"><option value="ru">Русский</option><option value="en">Английский</option></select>
   <p id="language-error" className="field-error">{state.errors?.language}</p>
   <label htmlFor="duration">Предполагаемая длительность, секунд</label>
   <input id="duration" name="duration" type="number" min={1} max={300} step={1} defaultValue={values.duration} required aria-invalid={!!state.errors?.duration} aria-describedby="duration-hint duration-error" />
   <p id="duration-hint" className="field-hint">От 1 до 300 секунд. Это ориентир для будущего сценария.</p>
   <p id="duration-error" className="field-error">{state.errors?.duration}</p>
   <button type="submit" className="button">{pending ? "Сохраняем…" : id ? "Сохранить изменения" : "Создать проект"}</button>
  </fieldset>
  <p className="form-message" role="status">{state.message}</p>
  <p><Link className="text-link" href={id ? "/projects/" + id : "/projects"}>Отмена</Link></p>
 </form>;
}
