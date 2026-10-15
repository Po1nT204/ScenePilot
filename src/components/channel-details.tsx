import { channelSnapshot, channelSummary } from "@/lib/channel";

export function ChannelDetails({ value }: { value: unknown }) {
  const profile = channelSnapshot(value);
  if (!profile) return null;
  return <details className="channel-details"><summary>Требования канала: {profile.name}</summary>
    <p className="project-full-topic">{channelSummary(profile)}</p>
    <p className="field-hint">Сохранённая копия требований. Последующие изменения профиля канала её не меняют.</p>
  </details>;
}
