import Link from "next/link";
import {notFound} from "next/navigation";
import {requireProjectUser} from "@/lib/projects/server";
import {isProjectId} from "@/lib/projects/validation";
import {ExportPanel} from "@/components/export-panel";
import {ProjectWorkspace} from "@/components/project-workspace";
import {type ExportSnapshot} from "@/lib/export";
import {publicationColumns,publicationPayload,publicationMigrationMessage} from "@/lib/publication";
export const dynamic="force-dynamic";
export const metadata={title:"Экспорт — ScenePilot"};
export default async function ExportPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{version?:string}>}) {
 const {supabase,user}=await requireProjectUser();
 const {id}=await params;
 const {version:versionId}=await searchParams;
 if(!isProjectId(id)||!versionId||!isProjectId(versionId)) notFound();
 const project=await supabase.from("projects").select("id,title").eq("id",id).eq("owner_id",user.id).maybeSingle();
 if(project.error) throw new Error("Project unavailable");
 if(!project.data) notFound();
 const version=await supabase.from("script_versions").select("id,version_number,created_at,content,settings_snapshot,source").eq("id",versionId).eq("project_id",id).maybeSingle();
 if(version.error) throw new Error("Version unavailable");
 if(!version.data) notFound();
 const scenes=await supabase.from("scenes").select("id,script_version_id,position,description,visual_prompt,narration,source").eq("script_version_id",versionId).order("position");
 if(scenes.error) return <section><h1>Экспорт недоступен</h1><p role="alert">Не удалось загрузить сохранённые сцены. Обновите страницу позже. Неполный файл не сформирован.</p><Link href={`/projects/${id}/scripts?version=${versionId}`}>Вернуться к сценарию</Link></section>;
 const saved=version.data;
 const [shots,plans]=await Promise.all([supabase.from('scene_shots').select('*').eq('script_version_id',versionId),supabase.from('scene_shot_plans').select('*').eq('script_version_id',versionId)]);
 if(shots.error||plans.error) return <><ProjectWorkspace projectId={id} title={project.data.title} current="export" version={saved}/><p role="alert">Не удалось загрузить кадры. Проверьте соединение и миграцию 202610160002_scene_shots.sql. Неполный архив не сформирован.</p></>;
 const publication=await supabase.from("publication_materials").select(publicationColumns).eq("script_version_id",versionId).maybeSingle();
 const material=publicationPayload(publication.data);
 if(publication.error || (publication.data && !material)) return <><ProjectWorkspace projectId={id} title={project.data.title} current="export" version={saved} /><section><h2>Экспорт недоступен</h2><p role="alert">{publication.error && ["42P01","PGRST205"].includes(publication.error.code) ? publicationMigrationMessage : "Не удалось загрузить материалы публикации. Обновите страницу позже. Неполный файл не сформирован."}</p></section></>;
 const snapshot=saved.settings_snapshot as ExportSnapshot;
 return <><ProjectWorkspace projectId={id} title={project.data.title} current="export" version={saved} />
 <section className="project-editor">
  <h2>Тексты и промпты</h2>
  {snapshot.title !== project.data.title && <p>Название в сохранённой версии: {snapshot.title}</p>}
  <p className="editor-note">В файл попадут только сохранённые данные этой версии. После правок в другой вкладке обновите страницу.</p>
  <ExportPanel key={saved.id} document={{versionId:saved.id,versionNumber:saved.version_number,createdAt:saved.created_at,content:saved.content,source:saved.source,snapshot,scenes:scenes.data,shots:shots.data,shotPlans:plans.data,publication:material ? {...material,script_version_id:versionId} : null}} />
 </section></>;
}
