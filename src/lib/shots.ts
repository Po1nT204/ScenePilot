import { isProjectId } from './projects/validation';
import type { SceneSource } from './scene-editing';

export const shotLimits = { perScene: 40, perVersion: 240, text: 1000, prompt: 2000, seconds: 60, bytes: 524288 } as const;
export const shotsMigrationMessage = 'Для кадров выполните миграцию 202610160002_scene_shots.sql по docs/setup.md.';
export type Shot = { id?: string; narration_excerpt: string; action: string; visual_prompt: string; duration_seconds: number; source: SceneSource };
export type SavedShot = Shot & { id: string; scene_id: string; script_version_id: string; position: number };
export function shotsPayload(value: unknown): Shot[] | null {
 if (!Array.isArray(value) || value.length > shotLimits.perScene) return null;
 const ids = new Set<string>();
 const result: Shot[] = [];
 for (const item of value) {
  if (!item || typeof item !== 'object') return null;
  if (!['manual','test','yandex'].includes(item.source) || !Number.isInteger(item.duration_seconds) || item.duration_seconds < 1 || item.duration_seconds > shotLimits.seconds) return null;
  for (const [field, limit] of [['narration_excerpt',1000],['action',1000],['visual_prompt',2000]] as const) {
   if (typeof item[field] !== 'string' || !item[field].trim() || item[field].length > limit) return null;
  }
  if (item.id !== undefined) {
   if (typeof item.id !== 'string' || !isProjectId(item.id) || ids.has(item.id.toLowerCase())) return null;
   ids.add(item.id.toLowerCase());
  }
  result.push({ ...(item.id ? {id:item.id} : {}), narration_excerpt:item.narration_excerpt.trim(), action:item.action.trim(), visual_prompt:item.visual_prompt.trim(), duration_seconds:item.duration_seconds, source:item.source });
 }
 return new TextEncoder().encode(JSON.stringify(result)).length <= shotLimits.bytes ? result : null;
}
