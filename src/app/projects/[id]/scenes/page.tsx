import { ProjectWorkspace } from "@/components/project-workspace";
import { notFound } from "next/navigation";
import { requireProjectUser } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
import { SceneEditor } from "@/components/scene-editor";
import { yandexReady } from "@/lib/ai/yandex";
import { stableSceneEditsPayload } from "@/lib/scene-editing";
export const dynamic = "force-dynamic";
export const metadata = {title: "Сцены — ScenePilot"};
export default async function ScenesPage({params,searchParams}: {params:Promise<{id:string}>;searchParams:Promise<{version?:string}>}) {
 const {id} = await params; const {version:versionId} = await searchParams;
 if(!isProjectId(id) || !versionId || !isProjectId(versionId)) notFound();
 const {supabase,user} = await requireProjectUser();
 const project = await supabase.from("projects").select("title").eq("id",id).eq("owner_id",user.id).maybeSingle();
 if(project.error) throw new Error("Project unavailable"); if(!project.data) notFound();
 const version = await supabase.from("script_versions").select("version_number,content,settings_snapshot").eq("id",versionId).eq("project_id",id).maybeSingle();
 if(version.error) throw new Error("Version unavailable"); if(!version.data) notFound();
 const result = await supabase.from("scenes").select("id,description,visual_prompt,narration,source").eq("script_version_id",versionId).order("position");
 const counts = await supabase.from("scene_shots").select("scene_id").eq("script_version_id",versionId);
 const parsed = result.error ? null : stableSceneEditsPayload(result.data);
 const initial = parsed?.map(scene => ({...scene,shot_count:counts.data?.filter(shot=>shot.scene_id===scene.id).length ?? 0})) ?? null;
 return <><ProjectWorkspace projectId={id} title={project.data.title} current="scenes" version={{ id: versionId, version_number: version.data.version_number }} />
 <section className="scene-page">
  <details className="editor-help"><summary>Исходный сценарий версии {version.data.version_number}</summary><p className="project-full-topic">{version.data.content}</p></details>
  {initial === null ? <p role="alert">{result.error && ["PGRST205","42P01"].includes(result.error.code) ? "Выполните миграции сцен по docs/setup.md в Supabase SQL Editor." : "Не удалось загрузить сцены. Обновите страницу позже."}</p> : <SceneEditor key={versionId} projectId={id} versionId={versionId} initial={initial} yandexEnabled={yandexReady()} scriptContent={version.data.content} targetDuration={version.data.settings_snapshot.target_duration_seconds} initialPace={version.data.settings_snapshot.narration_pace} />}
 {counts.error && <p role="alert">Кадры не загружены. Проверьте миграцию 202610160002_scene_shots.sql и соединение; удаление сцены с кадрами дополнительно защищено в базе.</p>}
 </section></>;
}
