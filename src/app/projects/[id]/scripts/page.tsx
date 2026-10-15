import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProjectUser } from "@/lib/projects/server";
import { isProjectId } from "@/lib/projects/validation";
import { ScriptEditor } from "@/components/script-editor";
import { ProjectWorkspace } from "@/components/project-workspace";
import { ChannelDetails } from "@/components/channel-details";
import type { ChannelProfile } from "@/lib/channel";
import { yandexReady } from "@/lib/ai/yandex";

export const metadata = { title: "Сценарий — ScenePilot" };
export const dynamic = "force-dynamic";
export default async function ScriptsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string; saved?: string }> }) {
 const { supabase, user } = await requireProjectUser();
 const { id } = await params;
 const query = await searchParams;
 if (!isProjectId(id) || (query.version && !isProjectId(query.version))) notFound();
 const project = await supabase.from("projects").select("id,title,target_duration_seconds").eq("id", id).eq("owner_id", user.id).maybeSingle();
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
 const snapshot = version?.settings_snapshot as { title: string; topic: string; genre: string; style: string; language: string; target_duration_seconds: number; channel?: ChannelProfile | null } | undefined;
 return <><ProjectWorkspace projectId={id} title={project.data.title} current="scripts" version={version} />
 <section className="project-editor">
  {query.saved === "1" && <p className="success-notice" role="status">Версия сохранена.</p>}
  <details className="version-history"><summary>История версий ({history.data.length})</summary>
   {history.data.length ? <ul>{history.data.map(item => <li key={item.id}><Link href={`/projects/${id}/scripts?version=${item.id}`} aria-current={selectedId === item.id ? "page" : undefined}>Версия {item.version_number}{selectedId === item.id ? " — открыта" : ""}</Link><time dateTime={item.created_at}>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Yekaterinburg" }).format(new Date(item.created_at))} UTC+5</time></li>)}</ul> : <p>Сохранённых версий пока нет.</p>}
  </details>
  {snapshot && <details><summary>Настройки на момент сохранения версии {version?.version_number}</summary><p>{snapshot.title}: {snapshot.topic}</p><p>{snapshot.genre} · {snapshot.style} · {snapshot.language === "ru" ? "Русский" : "Английский"} · {snapshot.target_duration_seconds} сек.</p></details>}
  <p className="field-hint">Новая версия получит текущие настройки проекта. Старые версии и их настройки остаются неизменными.</p>
  <ChannelDetails value={snapshot?.channel} />
  <ScriptEditor key={version?.id ?? "new"} projectId={id} initial={version?.content ?? ""} versionNumber={version?.version_number} initialSource={version?.source ?? "manual"} yandexEnabled={yandexReady()} targetDuration={project.data.target_duration_seconds} versionDuration={snapshot?.target_duration_seconds} />
 </section></>;
}
