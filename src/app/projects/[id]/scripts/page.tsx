import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProjectUser } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
import { ScriptEditor } from "@/components/script-editor";
import { yandexReady } from "@/lib/ai/yandex";

export const metadata = { title: "Сценарий — ScenePilot" };
export const dynamic = "force-dynamic";
export default async function ScriptsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string; saved?: string }> }) {
 const { supabase, user } = await requireProjectUser();
 const { id } = await params;
 const query = await searchParams;
 if (!isProjectId(id) || (query.version && !isProjectId(query.version))) notFound();
 const project = await supabase.from("projects").select("id,title").eq("id", id).eq("owner_id", user.id).maybeSingle();
 if (project.error) throw new Error("Project unavailable");
 if (!project.data) notFound();
 const history = await supabase.from("script_versions").select("id,version_number,created_at").eq("project_id", id).order("version_number", { ascending: false });
 if (history.error) return <section><h1>Сценарий</h1><p role="alert">{["PGRST205", "42P01"].includes(history.error.code) ? "Таблица версий ещё не настроена. Выполните миграцию 202610130001_create_script_versions.sql из README в Supabase SQL Editor." : "Не удалось загрузить версии. Обновите страницу позже."}</p><Link href={`/projects/${id}`}>Вернуться к проекту</Link></section>;
 const selectedId = query.version ?? history.data[0]?.id;
 const selected = selectedId ? await supabase.from("script_versions").select("id,version_number,content,settings_snapshot,source").eq("project_id", id).eq("id", selectedId).maybeSingle() : null;
 if (selected?.error && ["42703","PGRST204"].includes(selected.error.code)) return <p role="alert">Выполните миграцию 202610130003_script_source.sql из README для хранения источника сценария.</p>;
 if (selected?.error) throw new Error("Script unavailable");
 if (selectedId && !selected?.data) notFound();
 const version = selected?.data;
 const snapshot = version?.settings_snapshot as { title: string; topic: string; genre: string; style: string; language: string; target_duration_seconds: number } | undefined;
 return <section className="project-editor">
  <Link className="text-link" href={`/projects/${id}`}>← Настройки проекта</Link>
  <h1 className="auth-title">Сценарий: {project.data.title}</h1>
  {query.saved === "1" && <p className="success-notice" role="status">Версия сохранена.</p>}
  <nav aria-label="История версий"><h2>История версий</h2>
   {history.data.length ? <ul>{history.data.map(item => <li key={item.id}><Link href={`/projects/${id}/scripts?version=${item.id}`} aria-current={selectedId === item.id ? "page" : undefined}>Версия {item.version_number}{selectedId === item.id ? " — открыта" : ""}</Link></li>)}</ul> : <p>Сохранённых версий пока нет.</p>}
  </nav>
  {snapshot && <details><summary>Настройки на момент сохранения версии {version?.version_number}</summary><p>{snapshot.title}: {snapshot.topic}</p><p>{snapshot.genre} · {snapshot.style} · {snapshot.language === "ru" ? "Русский" : "Английский"} · {snapshot.target_duration_seconds} сек.</p></details>}
  <p className="field-hint">Новая версия получит текущие настройки проекта. Старые версии и их настройки остаются неизменными.</p>
  {version && <div className="workspace"><div><h2>От текста к сценам</h2><p>Откройте раскадровку сохранённой версии {version.version_number}: описание кадра, визуальный промпт и озвучка.</p><Link className="button" href={`/projects/${id}/scenes?version=${version.id}`}>Сцены версии {version.version_number}</Link></div></div>}
  <ScriptEditor key={version?.id ?? "new"} projectId={id} initial={version?.content ?? ""} versionNumber={version?.version_number} initialSource={version?.source ?? "manual"} yandexEnabled={yandexReady()} />
 </section>;
}
