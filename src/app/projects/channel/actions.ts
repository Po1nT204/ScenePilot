"use server";
import { revalidatePath } from "next/cache";
import { requireProjectUser } from "@/lib/projects/server";
import { validateChannel, channelMigrationMessage, type ChannelProfile } from "@/lib/channel";

export type ChannelState = { message: string; values: ChannelProfile; errors?: Partial<Record<keyof ChannelProfile, string>>; saved?: boolean };

export async function saveChannel(_previous: ChannelState, form: FormData): Promise<ChannelState> {
  const checked = validateChannel(Object.fromEntries(form));
  if (!checked.valid) return { message: "Проверьте выделенные поля.", values: checked.values, errors: checked.errors };
  const { supabase, user } = await requireProjectUser();
  try {
    const existing = await supabase.from("channel_profiles").select("owner_id").eq("owner_id", user.id).maybeSingle();
    if (existing.error) return { values: checked.values, message: ["42P01", "PGRST205"].includes(existing.error.code) ? channelMigrationMessage : "Не удалось прочитать профиль. Повторите позже." };
    const result = existing.data
      ? await supabase.from("channel_profiles").update(checked.values).eq("owner_id", user.id).select("owner_id").maybeSingle()
      : await supabase.from("channel_profiles").insert({ ...checked.values, owner_id: user.id }).select("owner_id").single();
    if (result.error || !result.data) return { values: checked.values, message: "Не удалось сохранить профиль. Проверьте соединение; если профиль создан в другой вкладке, обновите страницу." };
    revalidatePath("/projects/channel");
    revalidatePath("/projects/new");
    return { values: checked.values, message: "Профиль сохранён. Он будет использоваться в новых роликах; существующие материалы не изменились.", saved: true };
  } catch {
    return { values: checked.values, message: "Не удалось подтвердить сохранение. Поля остаются в форме; проверьте профиль перед повтором." };
  }
}
