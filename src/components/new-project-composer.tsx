'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ProjectForm } from './project-form';
import { ChannelDetails } from './channel-details';
import { channelProjectDefaults, type SavedChannelProfile } from '@/lib/channel';
import { emptyProject } from '@/lib/projects/validation';

export function NewProjectComposer({ profiles, initialId, yandexEnabled }: { profiles: SavedChannelProfile[]; initialId: string; yandexEnabled: boolean }) {
  const [selection, setSelection] = useState(initialId), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const profile = profiles.find(p => p.id === selection) ?? null;
  const initial = { ...emptyProject, language: profile?.language ?? 'ru', ...channelProjectDefaults(profile) };
  return <>
    <div className="channel-profile-picker">
      <label htmlFor="new-project-profile">Профиль канала</label>
      <select id="new-project-profile" value={selection} disabled={busy} onChange={e => {
        if (dirty && !window.confirm('Сменить профиль? Несохранённые настройки ролика и варианты замысла в этой форме будут сброшены.')) return;
        setSelection(e.target.value); setDirty(false);
      }}>
        <option value="">Без профиля</option>
        {profiles.map(p => <option key={p.id} value={p.id}>{p.name} · {p.language === 'ru' ? 'Русский' : 'Английский'}</option>)}
      </select>
      <p className="field-hint">Профиль необязателен. Его требования сохранятся вместе с роликом.</p>
      <Link className="text-link" href="/projects/channel" target="_blank" rel="noreferrer" aria-label="Настроить профили — в новой вкладке">Настроить профили ↗</Link>
    </div>
    {profile && <ChannelDetails value={profile} />}
    {profile && (!initial.genre || !initial.style) && <p className="field-hint">Подробные требования сохранятся целиком. Для жанра и стиля укажите короткие названия до 100 символов.</p>}
    <div onChangeCapture={() => setDirty(true)}>
      <ProjectForm key={selection || 'none'} initial={initial} profile={profile} profileId={profile?.id ?? null} profileRevision={profile?.updated_at ?? null} yandexEnabled={yandexEnabled} onBusyChange={setBusy} onEdited={() => setDirty(true)} />
    </div>
  </>;
}
