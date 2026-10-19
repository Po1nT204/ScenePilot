"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireProjectUser } from "@/lib/projects/server";
import { validateChannel, channelMigrationMessage, channelSchemaError, channelSelection, type ChannelProfile } from "@/lib/channel";

export type ChannelState = { message: string; values: ChannelProfile; errors?: Partial<Record<keyof ChannelProfile, string>>; saved?: boolean };
export async function saveChannel(_previous: ChannelState, form: FormData): Promise<ChannelState> {
  const checked = validateChannel(Object.fromEntries(form));
  if (!checked.valid) return { message: "Проверьте выделенные поля.", values: checked.values, errors: checked.errors };
  let selection;
  try { selection = channelSelection(form.get('profileId'), form.get('profileRevision')); }
  catch { return { values: checked.values, message: 'Выбор профиля устарел. Обновите страницу; сначала скопируйте нужный текст.' }; }
  const { supabase, user } = await requireProjectUser();
  let savedId: string;
  try {
    const result = selection.id
      ? await supabase.from("channel_profiles").update(checked.values).eq("id", selection.id).eq("owner_id", user.id).eq('updated_at', selection.revision!).select("id").maybeSingle()
      : await supabase.from("channel_profiles").insert({ ...checked.values, owner_id: user.id }).select("id").single();
    if (result.error) return { values: checked.values, message: channelSchemaError(result.error.code) ? channelMigrationMessage : 'Не удалось подтвердить сохранение. Текст остаётся в форме; проверьте список профилей перед повтором.' };
    if (!result.data) return { values: checked.values, message: 'Профиль изменён в другой вкладке или недоступен. Скопируйте правки и обновите страницу.' };
    savedId = result.data.id;
  } catch { return { values: checked.values, message: 'Не удалось подтвердить сохранение. Текст остаётся в форме; проверьте список профилей перед повтором.' }; }
  revalidatePath('/projects/channel'); revalidatePath('/projects/new');
  redirect(`/projects/channel?profile=${savedId}&saved=1`);
}
