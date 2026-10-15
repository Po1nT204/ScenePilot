import { ProjectForm } from "@/components/project-form";
import { SetupNotice } from "@/components/setup-notice";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireProjectUser } from "@/lib/projects/server";
import Link from "next/link";
import { channelColumns, channelMigrationMessage, channelSnapshot, channelProjectDefaults } from "@/lib/channel";
import { ChannelDetails } from "@/components/channel-details";
import { emptyProject } from "@/lib/projects/validation";
import { yandexReady } from "@/lib/ai/yandex";
export const metadata = { title: "Новый ролик — ScenePilot" };
export const dynamic = "force-dynamic";
export default async function NewProjectPage() {
 if (!getSupabaseConfig()) return <SetupNotice />;
 const { supabase, user } = await requireProjectUser();
 const result = await supabase.from("channel_profiles").select(channelColumns).eq("owner_id", user.id).maybeSingle();
 if (result.error) return <section className="project-editor"><h1 className="auth-title">Новый ролик</h1><p role="alert">{["42P01", "PGRST205"].includes(result.error.code) ? channelMigrationMessage : "Не удалось прочитать профиль. Обновите страницу позже."}</p><Link href="/projects" className="text-link">Мои ролики</Link></section>;
 const profile = channelSnapshot(result.data);
 const initial = { ...emptyProject, language: profile?.language ?? "ru", ...channelProjectDefaults(profile) };
 return <section className="project-editor"><h1 className="auth-title">Новый ролик</h1><p className="auth-description">Выберите замысел или заполните настройки самостоятельно. Сценарий создаётся после сохранения ролика.</p>
  {profile ? <ChannelDetails value={profile} /> : <p>Общие требования можно задать в <Link className="text-link" href="/projects/channel">профиле канала</Link>. Это необязательно.</p>}
  {profile && (!initial.genre || !initial.style) && <p className="field-hint">Подробные требования канала сохранятся целиком. Для жанра и стиля укажите короткие названия до 100 символов или выберите вариант замысла.</p>}
  <ProjectForm initial={initial} profile={profile} profileRevision={result.data?.updated_at ?? null} yandexEnabled={yandexReady()} /></section>;
}
