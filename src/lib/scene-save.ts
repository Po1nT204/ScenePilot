import { stableSceneEditsPayload, type SceneEdit } from './scene-editing';
type WriteResult = { data: unknown; error: { code?: string; message?: string } | null };
export function sameSceneText(a: SceneEdit[], b: SceneEdit[]) {
  return a.length === b.length && a.every((row, i) => (['description','visual_prompt','narration','source'] as const).every(k => row[k] === b[i][k]) && (!row.id || row.id === b[i].id));
}
export function sceneSaveError(error?: { code?: string; message?: string } | null) {
  if (error?.code === 'PGRST202') return 'Функция сохранения сцен не установлена. Проверьте миграцию 202610160002_scene_shots.sql по docs/setup.md.';
  if (error?.message?.includes('SHOT_DELETE_CONFIRMATION_REQUIRED')) return 'У удаляемой сцены есть кадры. Проверьте их и подтвердите удаление вместе со сценой.';
  if (error?.message?.includes('Invalid scene id')) return 'Сохранённый набор сцен изменился. Скачайте черновик, затем загрузите актуальный набор; устаревшие ID не записаны.';
  if (error?.code === '23505') return 'Конфликт порядка сцен в БД. Проверьте миграцию 202610160002_scene_shots.sql; черновик не потерян.';
  if (error?.code === '42501') return 'Нет доступа к версии. Проверьте вход в аккаунт; черновик не потерян.';
  const code = error?.code && /^[A-Z0-9]{5,12}$/.test(error.code) ? ` Код: ${error.code}.` : '';
  return `Подтверждение сохранения не получено.${code} Запись могла пройти. Нажмите «Проверить сохранение»; повторной записи автоматически не будет.`;
}
export async function saveScenesOnce(payload: SceneEdit[], write: () => PromiseLike<WriteResult>, read: () => Promise<SceneEdit[]>) {
  let result: WriteResult | undefined;
  try { result = await write(); } catch { /* Reconcile by reading, never repeat a mutation. */ }
  const saved = !result?.error && stableSceneEditsPayload(result?.data);
  if (saved && sameSceneText(payload, saved)) return { error: '', scenes: result!.data as SceneEdit[] };
  try {
    const current = await read();
    if (sameSceneText(payload, current)) return { error: '', scenes: current };
  } catch { /* Keep the draft and report uncertainty. */ }
  return { error: sceneSaveError(result?.error) };
}
