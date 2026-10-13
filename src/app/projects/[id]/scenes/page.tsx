import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProjectUser } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
import { SceneEditor } from "@/components/scene-editor";
import { yandexReady } from "@/lib/ai/yandex";
export const dynamic = "force-dynamic";
export const metadata = {title: "Сцены — ScenePilot"};
export default async function ScenesPage({params,searchParams}: {params:Promise<{id:string}>;searchParams:Promise<{version?:string}>}) {
 const {id} = await params; const {version:versionId} = await searchParams;
 if(!isProjectId(id) || !versionId || !isProjectId(versionId)) notFound();
 const {supabase,user} = await requireProjectUser();
 const project = await supabase.from("projects").select("title").eq("id",id).eq("owner_id",user.id).maybeSingle();
 if(project.error) throw new Error("Project unavailable"); if(!project.data) notFound();
 const version = await supabase.from("script_versions").select("version_number,content").eq("id",versionId).eq("project_id",id).maybeSingle();
 if(version.error) throw new Error("Version unavailable"); if(!version.data) notFound();
 const result = await supabase.from("scenes").select("description,visual_prompt,narration,source").eq("script_version_id",versionId).order("position");
 return <section className="scene-page">
  <Link className="text-link" href={`/projects/${id}/scripts?version=${versionId}`}>← К сценарию и истории версий</Link>
  <p className="eyebrow project-label">РАСКАДРОВКА · ВЕРСИЯ {version.data.version_number}</p>
  <h1 className="auth-title">{project.data.title}</h1>
  <p>Сцены относятся только к версии {version.data.version_number}. Новая версия сценария получает отдельный набор сцен.</p>
  <details><summary>Исходный сценарий версии {version.data.version_number}</summary><p className="project-full-topic">{version.data.content}</p></details>
  {result.error ? <p role="alert">{["PGRST205","42P01"].includes(result.error.code) ? "Выполните миграцию 202610130002_create_scenes.sql из README в Supabase SQL Editor." : "Не удалось загрузить сцены. Обновите страницу позже."}</p> : <SceneEditor key={versionId} projectId={id} versionId={versionId} initial={result.data.map(({description,visual_prompt,narration})=>({description,visual_prompt,narration}))} initialSource={result.data[0]?.source === "yandex" ? "yandex" : "test"} yandexEnabled={yandexReady()} />}
 </section>;
}
