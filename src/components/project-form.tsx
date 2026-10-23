"use client";
import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { saveProject } from "@/app/projects/actions";
import { emptyProject, projectLimits, type ProjectState, type ProjectValues } from "@/lib/projects/validation";
import { IdeaAssistant } from "./idea-assistant";
import type { ChannelProfile } from "@/lib/channel";
import { sourceLabel } from "@/lib/export";
import {durationLimits,supportsFullGeneration,longGenerationMessage} from "@/lib/duration";
const labels = { title: "Название ролика", topic: "Тема и идея", genre: "Жанр", style: "Стиль" };
export function ProjectForm({ id = null, initial = emptyProject, navigationVersion, profile = null, profileId = null, profileRevision = null, yandexEnabled = false, onBusyChange, onEdited }: { id?: string | null; initial?: ProjectValues; navigationVersion?: string; profile?: ChannelProfile | null; profileId?: string | null; profileRevision?: string | null; yandexEnabled?: boolean; onBusyChange?: (busy: boolean) => void; onEdited?: () => void }) {
 const [state, action, pending] = useActionState(saveProject.bind(null, id), { message: "", values: initial } as ProjectState);
 const [values, setValues] = useState(initial);
 const [briefSource, setBriefSource] = useState("manual");
 const [generating, setGenerating] = useState(false);
 useEffect(() => { onBusyChange?.(pending || generating); }, [pending, generating, onBusyChange]);
 const change = (field: keyof ProjectValues, value: string) => { setValues(previous => ({ ...previous, [field]: value })); onEdited?.(); };
 return <form action={action} className="auth-form project-form">
  {!id && <>
    <input type="hidden" name="briefSource" value={briefSource} />
    <input type="hidden" name="profileId" value={profileId ?? ""} />
    <input type="hidden" name="profileRevision" value={profileRevision ?? ""} />
    <details className="idea-disclosure"><summary>Нужна идея? Подобрать замысел</summary>
    <IdeaAssistant profileId={profileId} profile={profile} profileRevision={profileRevision} language={values.language} duration={values.duration} yandexEnabled={yandexEnabled} disabled={pending} onBusy={setGenerating} onApply={(idea, source) => {
      if ((values.title.trim() || values.topic.trim() || values.genre !== initial.genre || values.style !== initial.style) && !window.confirm("Заменить название, тему, жанр и стиль в форме выбранным вариантом? Ваши несохранённые правки этих полей будут заменены.")) return;
      setValues(previous => ({ ...previous, ...idea })); setBriefSource(source); onEdited?.();
    }} />
    </details>
    <h2>Замысел и формат</h2>
    <p className="field-hint">Источник замысла: {sourceLabel(briefSource)}.</p>
  </>}
  {navigationVersion && <input type="hidden" name="navigationVersion" value={navigationVersion} />}
  <fieldset disabled={pending || generating}>
   <div className="brief-fields">
   {(["title", "topic", "genre", "style"] as const).map((field) => <div key={field} className={field === "title" || field === "topic" ? "form-wide" : undefined}>
    <label htmlFor={field}>{labels[field]}</label>
    {field === "topic" ? <textarea id={field} name={field} value={values[field]} onChange={e => change(field, e.target.value)} required maxLength={projectLimits[field]} rows={5} aria-invalid={!!state.errors?.[field]} aria-describedby={field + "-error"} />
     : <input id={field} name={field} value={values[field]} onChange={e => change(field, e.target.value)} required maxLength={projectLimits[field]} aria-invalid={!!state.errors?.[field]} aria-describedby={field + "-error"} />}
    <p id={field + "-error"} className="field-error">{state.errors?.[field]}</p>
   </div>)}
   </div>
   <div className="brief-fields"><div>
   <label htmlFor="language">Язык видео</label>
   <select id="language" name="language" value={values.language} onChange={e => change("language", e.target.value)} aria-invalid={!!state.errors?.language} aria-describedby="language-error"><option value="ru">Русский</option><option value="en">Английский</option></select>
   <p id="language-error" className="field-error">{state.errors?.language}</p>
   </div><div>
   <label htmlFor="duration">Предполагаемая длительность, секунд</label>
   <input id="duration" name="duration" type="number" min={1} max={durationLimits.max} step={1} value={values.duration} onChange={e => change("duration", e.target.value)} required aria-invalid={!!state.errors?.duration} aria-describedby="duration-hint duration-error" />
   </div></div>
   <div className="scene-toolbar duration-presets" role="group" aria-label="Быстрый выбор длительности">{[1,5,8,10,12,15].map(minutes=><button type="button" className="text-button" key={minutes} onClick={()=>change("duration",String(minutes*60))} aria-pressed={values.duration===String(minutes*60)}>{minutes} мин</button>)}</div>
   <p id="duration-hint" className="field-hint">От 1 до {durationLimits.max} секунд (15 минут). Это цель, а не измеренный хронометраж.</p>
   {Number(values.duration)>durationLimits.fullGenerationMax && !supportsFullGeneration(Number(values.duration)) && <p className="field-hint">{longGenerationMessage}</p>}
   <p id="duration-error" className="field-error">{state.errors?.duration}</p>
   <button type="submit" className="button form-submit">{pending ? "Сохраняем…" : id ? "Сохранить изменения" : "Создать ролик"}</button>
  </fieldset>
  <p className="form-message" role="status">{state.message}</p>
  <p><Link className="text-link" href={id ? "/projects/" + id + (navigationVersion ? `?version=${navigationVersion}` : "") : "/projects"}>Отмена</Link></p>
 </form>;
}
