"use server";
import { revalidatePath } from "next/cache";
import { requireProjectUser } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
import { testScenes, validScenes, type SceneDraft } from "@/lib/scenes";
import {generateYandexScenes} from "@/lib/ai/yandex";
import {GenerationError} from "@/lib/ai/yandex-client";
import { stableSceneEditsPayload, type SceneEdit } from "@/lib/scene-editing";
import { saveScenesOnce } from "@/lib/scene-save";
import { unstable_rethrow } from "next/navigation";
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
export async function saveScenes(projectId: string, versionId: string, scenes: unknown, confirmedDeleteIds: string[] = []): Promise<{error:string;scenes?:SceneEdit[]}> {
 const payload = stableSceneEditsPayload(scenes);
 if (!Array.isArray(confirmedDeleteIds) || !confirmedDeleteIds.every(isProjectId)) return {error:"Некорректное подтверждение удаления."};
 if (!payload) return { error: "Допустимо до 12 сцен с указанным источником. Каждое поле должно содержать от 1 до 2000 символов." };
 try {
  const { supabase } = await ownedVersion(projectId,versionId);
  const result = await saveScenesOnce(payload,
   () => supabase.rpc("save_scene_edits_with_ids", { p_version_id: versionId, p_scenes: payload, p_confirm_delete_ids: confirmedDeleteIds }),
   async () => {
    const current = await supabase.from("scenes").select("id,description,visual_prompt,narration,source").eq("script_version_id",versionId).order("position");
    const parsed = current.error ? null : stableSceneEditsPayload(current.data);
    if (!parsed) throw new Error('Read failed');
    return parsed;
   });
  if (result.error) return result;
  revalidatePath(`/projects/${projectId}/scenes`);
  revalidatePath(`/projects/${projectId}/export`);
  revalidatePath("/projects");
  return result;
 } catch (error) { unstable_rethrow(error); return { error: "Соединение прервано или версия недоступна. Правки остаются в редакторе. Скачайте черновик перед перезагрузкой; проверьте сохранение после восстановления связи." }; }
}

export async function readSavedScenes(projectId: string, versionId: string): Promise<{error:string;scenes?:SceneEdit[]}> {
 try {
  const {supabase} = await ownedVersion(projectId,versionId);
  const result = await supabase.from('scenes').select('id,description,visual_prompt,narration,source').eq('script_version_id',versionId).order('position');
  const scenes = result.error ? null : stableSceneEditsPayload(result.data);
  if (!scenes) return {error:'Сохранённые сцены не удалось прочитать. Черновик оставлен; повторите проверку после восстановления связи.'};
  return {error:'',scenes};
 } catch(error) { unstable_rethrow(error); return {error:'Не удалось проверить сохранение. Черновик оставлен.'}; }
}
