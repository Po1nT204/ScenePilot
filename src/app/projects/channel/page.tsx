import Link from "next/link";
import { ChannelForm } from "@/components/channel-form";
import { requireProjectUser } from "@/lib/projects/server";
import { channelColumns, channelMigrationMessage, channelSnapshot, emptyChannel } from "@/lib/channel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Профиль канала — ScenePilot" };

export default async function ChannelPage() {
  const { supabase, user } = await requireProjectUser();
  const result = await supabase.from("channel_profiles").select(channelColumns).eq("owner_id", user.id).maybeSingle();
  return <section className="project-editor">
    <Link className="text-link" href="/projects">← Мои ролики</Link>
    <h1 className="auth-title project-label">Профиль канала</h1>
    <p className="auth-description">Общие требования к новым роликам: аудитория, темы и манера рассказа. Для одного аккаунта сохраняется один профиль.</p>
    <p>Изменения применяются к будущим роликам. Уже созданные ролики и сохранённые версии сохраняют свои требования.</p>
    {result.error ? <p role="alert">{["42P01", "PGRST205"].includes(result.error.code) ? channelMigrationMessage : "Не удалось загрузить профиль. Обновите страницу позже."}</p>
      : <ChannelForm initial={channelSnapshot(result.data) ?? emptyChannel} />}
  </section>;
}
