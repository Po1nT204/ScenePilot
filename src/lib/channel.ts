import { projectLimits } from './projects/validation';

export const channelLimits = {
  name: 120,
  audience: 400,
  topics: 1000,
  tone: 1000,
  format: 1000,
  avoid: 1000,
} as const;
export type ChannelProfile = Record<keyof typeof channelLimits, string> & {
  language: string;
};
export const emptyChannel: ChannelProfile = {
  name: '',
  audience: '',
  topics: '',
  tone: '',
  format: '',
  avoid: '',
  language: 'en',
};
export const channelColumns =
  'name,audience,topics,tone,format,avoid,language,updated_at';
export const channelMigrationMessage =
  'Для профиля канала и новых роликов выполните миграции профиля по docs/setup.md.';

// Detailed channel instructions stay in the snapshot, not in short project fields.
export function channelProjectDefaults(profile: ChannelProfile | null) {
  return {
    genre: profile && profile.format.length <= projectLimits.genre ? profile.format : '',
    style: profile && profile.tone.length <= projectLimits.style ? profile.tone : '',
  };
}

export function validateChannel(input: unknown) {
  const data =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  const values = { ...emptyChannel };
  const errors: Partial<Record<keyof ChannelProfile, string>> = {};
  for (const [key, max] of Object.entries(channelLimits)) {
    const field = key as keyof typeof channelLimits;
    const value = data[field];
    values[field] = typeof value === 'string' ? value.trim() : '';
    if (
      typeof value !== 'string' ||
      values[field].length > max ||
      (field !== 'avoid' && !values[field])
    ) {
      errors[field] =
        field === 'avoid'
          ? `Не более ${max} символов.`
          : `Введите от 1 до ${max} символов.`;
    }
  }
  values.language = typeof data.language === 'string' ? data.language : '';
  if (!['ru', 'en'].includes(values.language))
    errors.language = 'Выберите русский или английский язык.';
  return { values, errors, valid: Object.keys(errors).length === 0 };
}

// Whitelist only creative settings; never pass a DB row, owner id or timestamp to AI.
export function channelSnapshot(input: unknown): ChannelProfile | null {
  if (input == null) return null;
  const checked = validateChannel(input);
  if (!checked.valid) throw new Error('Invalid channel profile');
  return checked.values;
}

export function channelSummary(profile: ChannelProfile): string {
  return `Канал: ${profile.name}\nАудитория: ${profile.audience}\nТемы: ${profile.topics}\nТон: ${profile.tone}\nФормат: ${profile.format}\nИзбегать: ${profile.avoid || 'не указано'}\nЯзык профиля: ${profile.language}`;
}
