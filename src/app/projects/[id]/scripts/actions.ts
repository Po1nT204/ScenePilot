"use server";
import { revalidatePath } from "next/cache";
import { requireProjectUser } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
import { validateScript, type ScriptState } from "@/lib/scripts/validation";

export async function saveScript(projectId: string, _previous: ScriptState, form: FormData): Promise<ScriptState> {
 const checked = validateScript(form.get("content"));
 if (checked.error) return { message: checked.error };
 const source = form.get("source");
 if (typeof source !== "string" || !["manual","test","yandex","unknown"].includes(source)) return {message:"Неизвестный источник сценария."};
 if (!isProjectId(projectId)) return { message: "Проект не найден или недоступен." };
 const { supabase, user } = await requireProjectUser();
 try {
  const project = await supabase.from("projects").select("id").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
  if (project.error) return { message: "Не удалось проверить проект. Текст остаётся в редакторе." };
  if (!project.data) return { message: "Проект не найден или недоступен." };
  const { data, error } = await supabase.rpc("save_script_version", { p_project_id: projectId, p_content: checked.content, p_source:source });
  if (error) return { message: error.code === "PGRST202" ? "Выполните миграцию 202610130003_script_source.sql из README. Текст остаётся в редакторе." : "Не удалось сохранить версию. Текст остаётся в редакторе. Проверьте историю перед повторной попыткой." };
  if (typeof data !== "string" || !isProjectId(data)) return { message: "Не удалось подтвердить сохранение. Проверьте историю версий." };
  revalidatePath("/projects/" + projectId + "/scripts");
  revalidatePath("/projects");
  return { message: "Новая версия сохранена.", savedId: data };
 } catch {
  return { message: "Соединение прервано. Текст остаётся в редакторе. Проверьте историю перед повторной попыткой." };
 }
}
