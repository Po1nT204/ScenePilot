import Link from "next/link";
import { notFound } from 'next/navigation';
import { ChannelForm } from "@/components/channel-form";
import { requireProjectUser } from "@/lib/projects/server";
import { isProjectId } from '@/lib/projects/validation';
import { channelColumns, channelMigrationMessage, channelSchemaError, channelSnapshot, emptyChannel } from "@/lib/channel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Профили каналов — ScenePilot" };

export default async function ChannelPage({ searchParams }: { searchParams: Promise<{ profile?: string; saved?: string }> }) {
  const { supabase, user } = await requireProjectUser();
  const query = await searchParams;
  if (query.profile && query.profile !== 'new' && !isProjectId(query.profile)) notFound();
  const result = await supabase.from("channel_profiles").select(channelColumns).eq("owner_id", user.id).order('name').order('id');
  const profiles = result.data ?? [];
  const selected = query.profile === 'new' ? undefined : query.profile ? profiles.find(p => p.id === query.profile) : profiles[0];
  if (!result.error && query.profile && query.profile !== 'new' && !selected) notFound();
  return <section className="project-editor">
    <Link className="text-link" href="/projects">← Мои ролики</Link>
    <h1 className="auth-title project-label">Профили каналов</h1>
    <p className="auth-description">Сохраните отдельные требования для каждой тематики. Профиль выбирается при создании ролика; старые ролики и версии сохраняют свои настройки.</p>
    {result.error ? <p role="alert">{channelSchemaError(result.error.code) ? channelMigrationMessage : "Не удалось загрузить профили. Обновите страницу позже."}</p> : <>
      <nav className="channel-profile-list" aria-label="Профили каналов">
        {profiles.map(profile => <Link className="text-button" key={profile.id} href={`/projects/channel?profile=${profile.id}`} aria-current={selected?.id === profile.id ? 'page' : undefined}>{profile.name}<small>{profile.language === 'ru' ? 'Русский' : 'Английский'}</small></Link>)}
        <Link className="button secondary" href="/projects/channel?profile=new" aria-current={!selected ? 'page' : undefined}>+ Новый профиль</Link>
      </nav>
      {query.saved === '1' && selected && <p className="success-notice" role="status">Профиль «{selected.name}» сохранён. Существующие ролики не изменились.</p>}
      <h2>{selected ? selected.name : 'Новый профиль'}</h2>
      {selected && <p><Link className="text-link" href={`/projects/new?profile=${selected.id}`}>Создать ролик с этим профилем →</Link></p>}
      <ChannelForm key={selected ? `${selected.id}:${selected.updated_at}` : 'new'} id={selected?.id ?? null} revision={selected?.updated_at ?? null} initial={channelSnapshot(selected) ?? { ...emptyChannel, language: 'ru' }} />
    </>}
  </section>;
}
