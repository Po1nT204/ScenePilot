"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProjectUser, projectError } from "@/lib/projects/server";
import { isProjectId, validateProject, type ProjectState } from "@/lib/projects/validation";
import { channelMigrationMessage, channelSelection, channelSchemaError } from "@/lib/channel";
export async function saveProject(projectId: string | null, _previous: ProjectState, formData: FormData): Promise<ProjectState> {
 const checked = validateProject(formData);
 if (!checked.valid) return { message: "Проверьте выделенные поля.", values: checked.values, errors: checked.errors };
 if (projectId !== null && !isProjectId(projectId)) return { message: "Проект не найден или недоступен.", values: checked.values };
 const { supabase, user } = await requireProjectUser();
 let savedId: string;
 try {
  const briefSource = formData.get("briefSource");
  let selection: ReturnType<typeof channelSelection> = { id: null, revision: null };
  if (!projectId) {
   if (typeof briefSource !== "string" || !["manual", "test", "yandex"].includes(briefSource)) return { message: "Неизвестный источник замысла.", values: checked.values };
   try { selection = channelSelection(formData.get("profileId"), formData.get("profileRevision")); }
   catch (error) { return { message: (error as Error).message, values: checked.values }; }
   if (selection.id) {
    const profile = await supabase.from("channel_profiles").select("id,updated_at").eq("owner_id", user.id).eq("id", selection.id).maybeSingle();
    if (profile.error) return { message: channelSchemaError(profile.error.code) ? channelMigrationMessage : "Не удалось проверить профиль канала. Поля остаются в форме.", values: checked.values };
    if (!profile.data || profile.data.updated_at !== selection.revision) return { message: "Профиль канала изменился или недоступен. Скопируйте нужный текст и обновите страницу перед созданием ролика.", values: checked.values };
   }
  }
  const result = projectId
   ? await supabase.from("projects").update(checked.data).eq("id", projectId).eq("owner_id", user.id).select("id").maybeSingle()
   : await supabase.from("projects").insert({ ...checked.data, owner_id: user.id, brief_source: briefSource, channel_profile_id: selection.id, channel_profile_revision: selection.revision }).select("id").single();
  if (!projectId && channelSchemaError(result.error?.code)) return { message: channelMigrationMessage, values: checked.values };
  if (!projectId && ["40001", "42501"].includes(result.error?.code ?? "")) return { message: "Профиль изменился или недоступен. Обновите страницу перед созданием ролика. Поля остаются в форме.", values: checked.values };
  if (result.error?.code === "23514" && checked.data.target_duration_seconds > 300) return {message:"База отклонила настройки длинного ролика. Проверьте применение миграции 202610150005_long_pilot_duration.sql по docs/setup.md. Поля остаются в форме.",values:checked.values};
  if (result.error) return { message: projectError(result.error.code), values: checked.values };
  if (!result.data) return { message: "Проект не найден или недоступен.", values: checked.values };
  savedId = result.data.id;
 } catch { return { message: "Сервис недоступен. Ваш ввод сохранён в форме; попробуйте ещё раз.", values: checked.values }; }
 revalidatePath("/projects");
 revalidatePath("/projects/" + savedId);
 // A navigation hint only: it never determines which project or version is written.
 // The destination page checks that this UUID belongs to the user's project.
 const navigationVersion = formData.get("navigationVersion");
 const versionSuffix = projectId && isProjectId(navigationVersion) ? `&version=${navigationVersion}` : "";
 redirect("/projects/" + savedId + "?saved=1" + versionSuffix);
}
export async function deleteProject(projectId: string, _previous: ProjectState, formData: FormData): Promise<ProjectState> {
 if (!isProjectId(projectId)) return { message: "Проект не найден или недоступен." };
 if (formData.get("confirm") !== "on") return { message: "Подтвердите удаление проекта." };
 const { supabase, user } = await requireProjectUser();
 try {
  const { data, error } = await supabase.from("projects").delete().eq("id", projectId).eq("owner_id", user.id).select("id").maybeSingle();
  if (error) return { message: projectError(error.code) };
  if (!data) return { message: "Проект не найден или недоступен." };
 } catch { return { message: "Не удалось удалить проект. Проверьте соединение." }; }
 revalidatePath("/projects");
 redirect("/projects?deleted=1");
}
