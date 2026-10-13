"use server";
import { revalidatePath } from "next/cache";
import { requireProjectUser } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
import { testScenes, validScenes, type SceneDraft } from "@/lib/scenes";
import {generateYandexScenes} from "@/lib/ai/yandex";
import {GenerationError} from "@/lib/ai/yandex-client";
async function ownedVersion(projectId: string, versionId: string) {
 const { supabase, user } = await requireProjectUser();
 if (!isProjectId(projectId) || !isProjectId(versionId)) throw new Error("Invalid id");
 const project = await supabase.from("projects").select("id").eq("id",projectId).eq("owner_id",user.id).maybeSingle();
 if (project.error || !project.data) throw new Error("Project unavailable");
 const version = await supabase.from("script_versions").select("content,settings_snapshot").eq("id",versionId).eq("project_id",projectId).maybeSingle();
 if (version.error || !version.data) throw new Error("Version unavailable");
 return { supabase, version: version.data };
}
export async function generateSceneExamples(projectId: string, versionId: string, mode:"test"|"yandex"="test"):Promise<{scenes:SceneDraft[]|null;error:string;tokens?:number}> {
 if(mode!=="test" && mode!=="yandex") return {scenes:null,error:"Неизвестный режим генерации."};
 try {
  const { version } = await ownedVersion(projectId,versionId);
  const snapshot = version.settings_snapshot;
  if(mode === "yandex") {
   const result=await generateYandexScenes(version.content,snapshot);
   return {...result,error:""};
  }
  const scenes = testScenes(version.content, snapshot.language, snapshot.style);
  if (!validScenes(scenes)) throw new Error("Invalid result");
  return { scenes, error: "" };
 } catch(error) { return { scenes: null, error: error instanceof GenerationError ? error.message : "Не удалось получить сцены. Проверьте соединение и доступ к версии. Текущий набор не изменён." }; }
}
export async function saveScenes(projectId: string, versionId: string, scenes: unknown, source:"test"|"yandex"="test") {
 if(source!=="test" && source!=="yandex") return {error:"Неизвестный источник сцен."};
 if (!validScenes(scenes)) return { error: "Нужны 1–12 сцен. Каждое поле должно содержать от 1 до 2000 символов." };
 try {
  const { supabase } = await ownedVersion(projectId,versionId);
  const { error } = await supabase.rpc("save_scenes", { p_version_id: versionId, p_source:source, p_scenes: scenes.map(({description,visual_prompt,narration}) => ({description,visual_prompt,narration})) });
  if (error) return { error: error.code === "PGRST202" ? "Выполните миграцию 202610130004_yandex_scenes.sql из README. Правки остаются в редакторе." : "Не удалось сохранить сцены. Правки остаются в редакторе; проверьте сохранённый набор перед повтором." };
  revalidatePath(`/projects/${projectId}/scenes`);
  return { error: "" };
 } catch { return { error: "Соединение прервано или версия недоступна. Правки остаются в редакторе." }; }
}
