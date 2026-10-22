"use client";
import { useRef, useState } from "react";
import { suggestIdeas } from "@/app/projects/new/ideas";
import type { ChannelProfile } from "@/lib/channel";
import type { Idea, IdeaResult } from "@/lib/ideas";
import {durationLimits,validDuration} from "@/lib/duration";

export function IdeaAssistant({ profile, profileId, profileRevision, language, duration, yandexEnabled, disabled, onBusy, onApply }: {
  profile: ChannelProfile | null; profileId: string | null; profileRevision: string | null; language: string; duration: string;
  yandexEnabled: boolean; disabled: boolean; onBusy: (busy: boolean) => void; onApply: (idea: Idea, source: "test" | "yandex") => void;
}) {
  const [seed, setSeed] = useState(profile?.topics ?? "");
  const [result, setResult] = useState<{ response: IdeaResult; language: string; duration: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const history = useRef<string[]>([]);
  async function generate(mode: "test" | "yandex") {
    if (disabled || lock.current) return;
    if (!seed.trim() || seed.trim().length > 1000 || !/^\d+$/.test(duration) || !validDuration(Number(duration))) {
      setMessage(`Укажите направление и длительность от 1 до ${durationLimits.max} секунд.`); return;
    }
    if (mode === "yandex" && !window.confirm("Отправить направление, язык, длительность и сохранённые требования канала и названия последних роликов/вариантов в YandexGPT? Это отдельный платный запрос, до 2000 токенов ответа. Форма ролика не изменится до выбора варианта.")) return;
    lock.current = true; setBusy(true); onBusy(true);
    setMessage(mode === "yandex" ? "YandexGPT предлагает идеи. Ожидание до 45 секунд…" : "Готовим тестовые варианты…");
    try {
      const response = await suggestIdeas(seed, language, Number(duration), profileId, profileRevision, mode, history.current);
      if (response.error !== undefined) setMessage(response.error);
      else {
        history.current=[...new Set([...history.current,...response.ideas.map(idea=>idea.title)])].slice(-18);
        setResult({ response, language, duration });
        setMessage(`Варианты готовы. Выберите один и отредактируйте форму.${response.warning ? ` ${response.warning}` : ""}${response.tokens !== undefined ? ` Токенов: ${response.tokens}.` : ""}`);
      }
    } catch { setMessage("Не удалось получить идеи. Форма ролика не изменена; проверьте соединение и вход."); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  const stale = result && (result.language !== language || result.duration !== duration);
  return <section className="idea-assistant" aria-labelledby="idea-assistant-title">
    <h2 id="idea-assistant-title">Подобрать замысел</h2>
    <p>Получите варианты названия, темы, жанра и стиля. Можно заполнить форму ниже самостоятельно.</p>
    <label htmlFor="idea-seed">О чём хотите сделать ролик</label>
    <textarea id="idea-seed" rows={3} maxLength={1000} value={seed} disabled={busy || disabled} onChange={e => setSeed(e.target.value)} placeholder="Например: почему привычные вещи устроены именно так" />
    <p className="field-hint">Язык и длительность берутся из формы ниже. {profile ? `Требования канала: ${profile.name}.` : "Профиль канала пока не задан."}</p>
    <div className="idea-actions">
      <button className="button" type="button" disabled={busy || disabled || !yandexEnabled} onClick={() => void generate("yandex")}>Предложить с YandexGPT · платно</button>
      <button className="text-button" type="button" disabled={busy || disabled} onClick={() => void generate("test")}>Тестовые варианты · бесплатно</button>
    </div>
    {!yandexEnabled && <p className="field-hint">YandexGPT выключен. Доступны ручной ввод и тестовые шаблоны.</p>}
    <p role="status">{message}</p>
    {result?.response.ideas && <>
      <p className="idea-source">Источник вариантов: {result.response.source === "yandex" ? "YandexGPT" : "тестовый шаблон, модель не вызывалась"}.</p>
      {stale && <p role="status">Язык или длительность изменились. Получите новые варианты или верните прежние параметры.</p>}
      <div className="idea-list">{result.response.ideas.map((idea, index) => <article className="idea-card" key={index}>
        <h3>{idea.title}</h3><p>{idea.topic}</p><p className="project-meta">{idea.genre} · {idea.style}</p>
        <button className="text-button" type="button" disabled={busy || disabled || !!stale} onClick={() => onApply(idea, result.response.source!)}>Заполнить форму этим вариантом</button>
      </article>)}</div>
    </>}
  </section>;
}
