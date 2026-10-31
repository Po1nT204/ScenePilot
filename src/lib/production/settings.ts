import { validVoice, type VideoJob } from './model';
import { selectedImageProvider, validImageSelection, type ImageSelection } from './image-catalog';
import { normalizeVisualGuide, validVisualStyle, type VisualStyle } from './visual-style';

export type ProductionSettings = { voiceId: string; imageProvider: ImageSelection; visualStyle: VisualStyle; visualGuide: string; subtitlesEnabled: boolean };
// An explicit allowlist: never inherit assets, narration, attempts or spending consent.
export function productionSettings(job: Pick<VideoJob, 'voiceId' | 'imageProvider' | 'visualStyle' | 'visualGuide' | 'subtitlesEnabled'>): ProductionSettings {
  const imageProvider = selectedImageProvider(job), visualStyle = job.visualStyle ?? 'original', subtitlesEnabled = job.subtitlesEnabled ?? true;
  if (!validVoice(job.voiceId) || !validImageSelection(imageProvider) || !validVisualStyle(visualStyle) || typeof subtitlesEnabled !== 'boolean') throw new Error('Настройки исходной сборки повреждены. Создайте план с новыми настройками.');
  return { voiceId: job.voiceId, imageProvider, visualStyle, visualGuide: normalizeVisualGuide(job.visualGuide ?? ''), subtitlesEnabled };
}
