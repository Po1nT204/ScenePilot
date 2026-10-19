"use client";
import { useActionState } from "react";
import { saveChannel } from "@/app/projects/channel/actions";
import { channelLimits, type ChannelProfile } from "@/lib/channel";

const labels = { name: "Название канала", audience: "Для кого ролики", topics: "Темы канала", tone: "Тон и стиль речи", format: "Формат роликов", avoid: "Слова и приёмы, которых следует избегать" };
const hints = { name: "Рабочее название — его можно изменить.", audience: "Например: люди без технической подготовки, которым интересно устройство обычных вещей.", topics: "Какие вопросы вы хотите разбирать и какие темы не подходят.", tone: "Например: спокойный, конкретный, без рекламных обещаний.", format: "Например: объяснение с примерами и простой графикой.", avoid: "Необязательно. Например: «погрузимся в мир», «в современном мире»." };

export function ChannelForm({ initial, id, revision }: { initial: ChannelProfile; id: string | null; revision: string | null }) {
  const [state, action, pending] = useActionState(saveChannel, { values: initial, message: "" });
  return <form action={action} className="auth-form project-form">
    <input type="hidden" name="profileId" value={id ?? ""} />
    <input type="hidden" name="profileRevision" value={revision ?? ""} />
    <fieldset disabled={pending}>
      {(Object.keys(channelLimits) as (keyof typeof channelLimits)[]).map(field => <div key={field}>
        <label htmlFor={`channel-${field}`}>{labels[field]}</label>
        <textarea id={`channel-${field}`} name={field} rows={field === "topics" || field === "audience" ? 3 : 2} maxLength={channelLimits[field]} required={field !== "avoid"} defaultValue={state.values[field]} aria-invalid={!!state.errors?.[field]} aria-describedby={`channel-${field}-hint channel-${field}-error`} />
        <p className="field-hint" id={`channel-${field}-hint`}>{hints[field]}</p>
        <p className="field-error" id={`channel-${field}-error`}>{state.errors?.[field]}</p>
      </div>)}
      <label htmlFor="channel-language">Основной язык роликов</label>
      <select id="channel-language" name="language" defaultValue={state.values.language} aria-describedby="channel-language-error"><option value="ru">Русский</option><option value="en">Английский</option></select>
      <p className="field-error" id="channel-language-error">{state.errors?.language}</p>
      <button className="button" type="submit">{pending ? "Сохраняем…" : "Сохранить профиль"}</button>
    </fieldset>
    <p className={state.saved ? "form-message success" : "form-message"} role="status">{state.message}</p>
  </form>;
}
