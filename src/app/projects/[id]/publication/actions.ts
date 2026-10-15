"use server";
import { revalidatePath } from 'next/cache';
import { requireProjectUser } from '@/lib/projects/server';
import { isProjectId } from '@/lib/projects/validation';
import { publicationPayload, testPublication, publicationMigrationMessage, type PublicationDraft } from '@/lib/publication';
import { generateYandexPublication } from '@/lib/ai/yandex';
import { GenerationError } from '@/lib/ai/yandex-client';

async function ownedVersion(projectId: string, versionId: string) {
 const {supabase,user} = await requireProjectUser();
 if (!isProjectId(projectId) || !isProjectId(versionId)) throw new Error('Invalid id');
 const project = await supabase.from('projects').select('id').eq('id',projectId).eq('owner_id',user.id).maybeSingle();
 if (project.error || !project.data) throw new Error('Project unavailable');
 const version = await supabase.from('script_versions').select('content,settings_snapshot').eq('id',versionId).eq('project_id',projectId).maybeSingle();
 if (version.error || !version.data) throw new Error('Version unavailable');
 return {supabase,version:version.data};
}

export async function generatePublication(projectId: string, versionId: string, mode: 'test' | 'yandex'): Promise<{material?:PublicationDraft;tokens?:number;error?:string}> {
 if (mode !== 'test' && mode !== 'yandex') return {error:'Неизвестный режим генерации.'};
 try {
  const {supabase,version} = await ownedVersion(projectId,versionId);
  // Check storage availability before any paid request.
  const storage = await supabase.from('publication_materials').select('script_version_id').eq('script_version_id',versionId).maybeSingle();
  if (storage.error) return {error:['42P01','PGRST205'].includes(storage.error.code) ? publicationMigrationMessage : 'Не удалось проверить сохранённые материалы. Запрос к модели не выполнен.'};
  if (mode === 'test') return {material:testPublication(version.content,version.settings_snapshot)};
  return await generateYandexPublication(version.content,version.settings_snapshot);
 } catch (error) {
  return {error:error instanceof GenerationError ? error.message : 'Не удалось получить материалы. Проверьте соединение и доступ к версии. Прежний текст не изменён.'};
 }
}

export async function savePublication(projectId: string, versionId: string, input: unknown) {
 const material = publicationPayload(input);
 if (!material) return {error:'Заполните заголовок до 100 и описание до 5000 символов. Вариантов заголовка — не более трёх, до 100 символов каждый.'};
 try {
  const {supabase} = await ownedVersion(projectId,versionId);
  const {error} = await supabase.rpc('save_publication_materials',{p_version_id:versionId,p_material:material});
  if (error) return {error:error.code === 'PGRST202' ? publicationMigrationMessage : 'Не удалось сохранить материалы. Текст остаётся в редакторе; проверьте сохранённый результат перед повтором.'};
  revalidatePath(`/projects/${projectId}/publication`);
  revalidatePath(`/projects/${projectId}/export`);
  return {error:''};
 } catch { return {error:'Соединение прервано или версия недоступна. Текст остаётся в редакторе.'}; }
}
