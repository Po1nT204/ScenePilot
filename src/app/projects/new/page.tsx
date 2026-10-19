import { NewProjectComposer } from "@/components/new-project-composer";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireProjectUser } from "@/lib/projects/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { channelColumns, channelMigrationMessage, channelSchemaError, channelSnapshot, type SavedChannelProfile } from "@/lib/channel";
import { isProjectId } from "@/lib/projects/validation";
import { yandexReady } from "@/lib/ai/yandex";
export const metadata = { title: "Новый ролик — ScenePilot" };
export const dynamic = "force-dynamic";
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ profile?: string }> }) {
 if (!getSupabaseConfig()) return <SetupNotice />;
 const { profile: requested } = await searchParams;
 if (requested !== undefined && requested !== "none" && !isProjectId(requested)) notFound();
 const { supabase, user } = await requireProjectUser();
 const result = await supabase.from("channel_profiles").select(channelColumns).eq("owner_id", user.id).order("name").order("id");
 if (result.error) return <section className="project-editor"><h1 className="auth-title">Новый ролик</h1><p role="alert">{channelSchemaError(result.error.code) ? channelMigrationMessage : "Не удалось прочитать профили. Обновите страницу позже."}</p><Link href="/projects" className="text-link">Мои ролики</Link></section>;
 const profiles: SavedChannelProfile[] = (result.data ?? []).flatMap(row => {
  const profile = channelSnapshot(row);
  return profile ? [{ ...profile, id: row.id, updated_at: row.updated_at }] : [];
 });
 if (requested && requested !== "none" && !profiles.some(p => p.id === requested)) notFound();
 const initialId = requested === "none" ? "" : requested ?? (profiles.length === 1 ? profiles[0].id : "");
 return <section className="project-editor"><h1 className="auth-title">Новый ролик</h1><p className="auth-description">Выберите профиль и замысел или заполните настройки самостоятельно. Сценарий создаётся после сохранения ролика.</p>
  <NewProjectComposer profiles={profiles} initialId={initialId} yandexEnabled={yandexReady()} />
 </section>;
}
