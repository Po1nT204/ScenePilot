export const flowCameraMoves = {
  still: { label: 'Неподвижная камера', prompt: 'Keep the camera locked off; animate only the subjects and environment.' },
  push: { label: 'Плавное приближение', prompt: 'Use a slow, subtle camera push-in toward the main subject.' },
  pan: { label: 'Медленная панорама', prompt: 'Use a gentle horizontal camera pan while keeping the main subject in frame.' },
} as const;

export type FlowCameraMove = keyof typeof flowCameraMoves;

export function flowMotionPrompt(description: string, camera: FlowCameraMove) {
  return `Animate the supplied first frame into one continuous shot. Preserve the identity, appearance and composition of the existing subjects. Give the subjects natural, physically plausible movement appropriate to the scene, with subtle environmental motion. ${flowCameraMoves[camera].prompt} No cuts, new subjects, captions or text. Scene description: ${description}`;
}
