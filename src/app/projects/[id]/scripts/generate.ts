"use server";
import { requireProjectUser } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
import { generateTestScript, type GenerationResult } from "@/lib/scripts/test-generator";
import { validateScript } from "@/lib/scripts/validation";

export async function generateScriptExample(projectId: string): Promise<GenerationResult> {
 if (!isProjectId(projectId)) return { error: "Проект не найден или недоступен." };
 const { supabase, user } = await requireProjectUser();
 try {
  const { data, error } = await supabase.from("projects")
   .select("title,topic,genre,style,language,target_duration_seconds")
   .eq("id", projectId).eq("owner_id", user.id).maybeSingle();
  if (error) return { error: "Не удалось загрузить настройки проекта. Текст в редакторе не изменён." };
  if (!data) return { error: "Проект не найден или недоступен." };
  const checked = validateScript(generateTestScript(data));
  if (checked.error) return { error: "Тестовый ответ не прошёл проверку. Текст в редакторе не изменён." };
  return { content: checked.content };
 } catch {
  return { error: "Сервис недоступен. Повторите попытку позже; текст в редакторе не изменён." };
 }
}
