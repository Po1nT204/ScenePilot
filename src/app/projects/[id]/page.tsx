import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteProjectForm } from "@/components/delete-project-form";
import { ProjectForm } from "@/components/project-form";
import { ProjectWorkspace } from "@/components/project-workspace";
import { ChannelDetails } from "@/components/channel-details";
import { channelMigrationMessage } from "@/lib/channel";
import { sourceLabel } from "@/lib/export";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireProjectUser, projectColumns } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
export const metadata = { title: "Проект — ScenePilot" };
export const dynamic = "force-dynamic";
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; saved?: string; version?: string }> }) {
 if (!getSupabaseConfig()) return <SetupNotice />;
 const { supabase, user } = await requireProjectUser();
 const { id } = await params;
 if (!isProjectId(id)) notFound();
 const { data: project, error } = await supabase.from("projects").select(projectColumns).eq("id", id).eq("owner_id", user.id).maybeSingle();
 if (error && ["42703", "PGRST204"].includes(error.code)) return <p role="alert">{channelMigrationMessage}</p>;
 if (error) throw new Error("Project unavailable");
 if (!project) notFound();
 const query = await searchParams;
 if (query.version && !isProjectId(query.version)) notFound();
 const versionQuery = supabase.from("script_versions").select("id,version_number").eq("project_id", id);
 const selected = query.version
  ? await versionQuery.eq("id", query.version).maybeSingle()
  : await versionQuery.order("version_number", { ascending: false }).limit(1).maybeSingle();
 if (selected.error) throw new Error("Versions unavailable");
 if (query.version && !selected.data) notFound();
 const version = selected.data;
 const versionSuffix = version ? `&version=${version.id}` : "";
 return <><ProjectWorkspace projectId={id} title={project.title} current="settings" version={version} />
 <section className="project-editor">
  <h2>Настройки ролика</h2>
  <p className="field-hint">Источник замысла: {sourceLabel(project.brief_source)}. Ручная правка сохраняет отметку исходного материала.</p>
  <ChannelDetails value={project.channel_snapshot} />
  {query.saved === "1" && query.edit !== "1" && <p className="success-notice" role="status">Изменения сохранены.</p>}
  {query.edit === "1" ? <ProjectForm id={id} navigationVersion={version?.id} initial={{ title: project.title, topic: project.topic, genre: project.genre, style: project.style, language: project.language, duration: String(project.target_duration_seconds) }} /> : <>
   <p className="project-full-topic">{project.topic}</p>
   <dl className="project-facts"><div><dt>Жанр</dt><dd>{project.genre}</dd></div><div><dt>Стиль</dt><dd>{project.style}</dd></div><div><dt>Язык</dt><dd>{project.language === "ru" ? "Русский" : "Английский"}</dd></div><div><dt>Длительность</dt><dd>{project.target_duration_seconds} сек.</dd></div></dl>
   <Link className="button" href={"/projects/" + id + "?edit=1" + versionSuffix}>Изменить настройки</Link>
   <DeleteProjectForm id={id} />
  </>}
 </section></>;
}
