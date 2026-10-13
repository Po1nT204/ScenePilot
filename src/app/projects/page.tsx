import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireProjectUser, projectError } from "@/lib/projects/server";
export const metadata: Metadata = { title: "Мои проекты — ScenePilot" };
export const dynamic = "force-dynamic";
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
 if (!getSupabaseConfig()) return <SetupNotice />;
 const { supabase, user } = await requireProjectUser();
 const { data: projects, error } = await supabase.from("projects").select("id,title,topic,genre,language,target_duration_seconds,updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false });
 const query = await searchParams;
 return <>
  <div className="project-heading"><div><p className="eyebrow">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</p><h1 className="auth-title">Мои проекты</h1><p className="auth-description">Вы вошли как {user.email}.</p></div>{!error && <Link className="button" href="/projects/new">+ Новый проект</Link>}</div>
  {query.deleted === "1" && <p className="success-notice" role="status">Проект удалён.</p>}
  {error ? <section className="workspace"><div><h2>Не удалось загрузить проекты</h2><p role="alert">{projectError(error.code)}</p></div></section>
   : projects.length === 0 ? <section className="workspace"><div><h2>Ваша первая история начинается здесь</h2><p>Создайте проект и задайте тему, жанр и стиль будущего видео.</p><Link className="text-link" href="/projects/new">Создать первый проект →</Link></div></section>
   : <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id}>
    <p className="eyebrow">{project.language === "ru" ? "РУССКИЙ" : "АНГЛИЙСКИЙ"} · {project.target_duration_seconds} СЕК.</p>
    <h2><Link href={"/projects/" + project.id}>{project.title}</Link></h2>
    <p className="project-topic">{project.topic}</p><p className="project-meta">{project.genre}</p><Link className="text-link" href={"/projects/" + project.id}>Открыть проект →</Link>
   </article>)}</div>}
 </>;
}
