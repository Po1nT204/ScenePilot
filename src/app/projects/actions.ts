"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProjectUser, projectError } from "@/lib/projects/server";
import { isProjectId, validateProject, type ProjectState } from "@/lib/projects/validation";
export async function saveProject(projectId: string | null, _previous: ProjectState, formData: FormData): Promise<ProjectState> {
 const checked = validateProject(formData);
 if (!checked.valid) return { message: "Проверьте выделенные поля.", values: checked.values, errors: checked.errors };
 if (projectId !== null && !isProjectId(projectId)) return { message: "Проект не найден или недоступен.", values: checked.values };
 const { supabase, user } = await requireProjectUser();
 let savedId: string;
 try {
  const result = projectId
   ? await supabase.from("projects").update(checked.data).eq("id", projectId).eq("owner_id", user.id).select("id").maybeSingle()
   : await supabase.from("projects").insert({ ...checked.data, owner_id: user.id }).select("id").single();
  if (result.error) return { message: projectError(result.error.code), values: checked.values };
  if (!result.data) return { message: "Проект не найден или недоступен.", values: checked.values };
  savedId = result.data.id;
 } catch { return { message: "Сервис недоступен. Ваш ввод сохранён в форме; попробуйте ещё раз.", values: checked.values }; }
 revalidatePath("/projects");
 revalidatePath("/projects/" + savedId);
 redirect("/projects/" + savedId + "?saved=1");
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
