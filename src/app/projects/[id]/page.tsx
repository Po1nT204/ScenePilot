import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteProjectForm } from "@/components/delete-project-form";
import { ProjectForm } from "@/components/project-form";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireProjectUser, projectColumns } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
export const metadata = { title: "Проект — ScenePilot" };
export const dynamic = "force-dynamic";
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; saved?: string }> }) {
 if (!getSupabaseConfig()) return <SetupNotice />;
 const { supabase, user } = await requireProjectUser();
 const { id } = await params;
 if (!isProjectId(id)) notFound();
 const { data: project, error } = await supabase.from("projects").select(projectColumns).eq("id", id).eq("owner_id", user.id).maybeSingle();
 if (error) throw new Error("Project unavailable");
 if (!project) notFound();
 const query = await searchParams;
 return <section className="project-editor">
  <Link className="text-link" href="/projects">← Все проекты</Link><p className="eyebrow project-label">ПРОЕКТ · ИДЕЯ</p><h1 className="auth-title">{project.title}</h1>
  {query.saved === "1" && query.edit !== "1" && <p className="success-notice" role="status">Изменения сохранены.</p>}
  {query.edit === "1" ? <ProjectForm id={id} initial={{ title: project.title, topic: project.topic, genre: project.genre, style: project.style, language: project.language, duration: String(project.target_duration_seconds) }} /> : <>
   <p className="project-full-topic">{project.topic}</p>
   <dl className="project-facts"><div><dt>Жанр</dt><dd>{project.genre}</dd></div><div><dt>Стиль</dt><dd>{project.style}</dd></div><div><dt>Язык</dt><dd>{project.language === "ru" ? "Русский" : "Английский"}</dd></div><div><dt>Длительность</dt><dd>{project.target_duration_seconds} сек.</dd></div></dl>
   <Link className="button" href={"/projects/" + id + "?edit=1"}>Редактировать проект</Link>
   <section className="workspace"><div><h2>Сценарий и версии</h2><p>Напишите сценарий и сохраните версию. Каждая правка сохраняется отдельно от предыдущего текста.</p><Link className="button" href={`/projects/${id}/scripts`}>Открыть сценарий</Link></div></section>
   <DeleteProjectForm id={id} />
  </>}
 </section>;
}
