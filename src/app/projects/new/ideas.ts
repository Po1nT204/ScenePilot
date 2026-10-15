"use server";
import { requireProjectUser } from "@/lib/projects/server";
import { channelColumns, channelSnapshot, channelMigrationMessage } from "@/lib/channel";
import { validateIdeaRequest, testIdeas, type IdeaResult } from "@/lib/ideas";
import { generateYandexIdeas } from "@/lib/ai/yandex";
import { GenerationError } from "@/lib/ai/yandex-client";
import { durationLimits } from "@/lib/duration";

export async function suggestIdeas(seed: string, language: string, duration: number, profileRevision: string | null, mode: "test" | "yandex"): Promise<IdeaResult> {
  const checked = validateIdeaRequest(seed, language, duration);
  if (!checked || !["test", "yandex"].includes(mode)) return { error: `Укажите направление до 1000 символов, язык и длительность от 1 до ${durationLimits.max} секунд.` };
  const { supabase, user } = await requireProjectUser();
  try {
    const profile = await supabase.from("channel_profiles").select(channelColumns).eq("owner_id", user.id).maybeSingle();
    if (profile.error) return { error: ["42P01", "PGRST205"].includes(profile.error.code) ? channelMigrationMessage : "Профиль не удалось загрузить. Запрос к модели не выполнен." };
    if ((profile.data?.updated_at ?? null) !== profileRevision) return { error: "Профиль канала изменился. Скопируйте нужный текст и обновите страницу перед генерацией." };
    const request = { ...checked, channel: channelSnapshot(profile.data) };
    if (mode === "test") return { ideas: testIdeas(request), source: "test" };
    return { ...await generateYandexIdeas(request), source: "yandex" };
  } catch (error) {
    return { error: error instanceof GenerationError ? error.message : "Не удалось получить идеи. Форма ролика не изменена." };
  }
}
