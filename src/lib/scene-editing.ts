import { validScenes, type SceneDraft } from './scenes';

export type SceneSource = 'manual' | 'test' | 'yandex';
export type SceneEdit = SceneDraft & { source: SceneSource; id?: string; shot_count?: number };
export type EditorScene = SceneEdit & { key: string };

// Only this editing path accepts an empty set. Generated responses still require scenes.
export function sceneEditsPayload(value: unknown): SceneEdit[] | null {
  if (!Array.isArray(value) || (value.length > 0 && !validScenes(value))) return null;
  if (!value.every(scene => ['manual', 'test', 'yandex'].includes(scene.source))) return null;
  return value.map(({ description, visual_prompt, narration, source }) => ({
    description: description.trim(), visual_prompt: visual_prompt.trim(), narration: narration.trim(), source,
  }));
}

export function stableSceneEditsPayload(value: unknown): SceneEdit[] | null {
  const payload = sceneEditsPayload(value);
  if (!payload || !Array.isArray(value)) return null;
  const ids = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const id = value[i].id;
    if (id !== undefined) {
      if (typeof id !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) || ids.has(id.toLowerCase())) return null;
      ids.add(id.toLowerCase()); payload[i].id = id;
    }
  }
  return payload;
}

export function addScene(scenes: EditorScene[], key: string): EditorScene[] {
  if (scenes.length >= 12 || scenes.some(scene => scene.key === key)) return scenes;
  return [...scenes, { key, source: 'manual', description: '', visual_prompt: '', narration: '' }];
}

export function moveScene(scenes: EditorScene[], key: string, direction: -1 | 1): EditorScene[] {
  const from = scenes.findIndex(scene => scene.key === key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= scenes.length) return scenes;
  const next = [...scenes];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function removeScene(scenes: EditorScene[], key: string): EditorScene[] {
  return scenes.filter(scene => scene.key !== key);
}
