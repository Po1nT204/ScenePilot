export const videoFps = 24;

export function clipFit(sourceFrames: number, targetFrames: number) {
  if (![sourceFrames, targetFrames].every(n => Number.isInteger(n) && n > 0)) throw new Error('Некорректная длительность клипа.');
  if (targetFrames <= sourceFrames) return { kind: 'trim' as const, stretch: 1, fadeFrames: 0 };
  // At most 25% longer: playback stays at least 80% of the original speed.
  if (targetFrames <= sourceFrames * 1.25) return { kind: 'slow' as const, stretch: targetFrames / sourceFrames, fadeFrames: 0 };
  if (sourceFrames < 4) return { kind: 'loop' as const, stretch: 1, fadeFrames: 0 };
  return { kind: 'smooth' as const, stretch: 1, fadeFrames: Math.min(12, Math.floor(sourceFrames / 4)) };
}
