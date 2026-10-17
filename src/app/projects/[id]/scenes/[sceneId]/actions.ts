"use server";
import { revalidatePath } from 'next/cache';
import { requireProjectUser } from '@/lib/projects/server';
import { isProjectId } from '@/lib/projects/validation';
import { shotsPayload, shotsMigrationMessage, type Shot } from '@/lib/shots';

export async function saveShots(projectId:string,versionId:string,sceneId:string,value:unknown,expectedNarration:string):Promise<{error:string;shots?:Shot[]}> {
 const payload=shotsPayload(value);
 if(![projectId,versionId,sceneId].every(isProjectId) || !payload || typeof expectedNarration!=='string' || expectedNarration.length>2000) return {error:'Проверьте поля кадров: текст до 1000, промпт до 2000 символов, длительность — целое число 1–60.'};
 try {
  const {supabase,user}=await requireProjectUser();
  const project=await supabase.from('projects').select('id').eq('id',projectId).eq('owner_id',user.id).maybeSingle();
  if(project.error || !project.data) return {error:'Проект недоступен.'};
  const version=await supabase.from('script_versions').select('id').eq('id',versionId).eq('project_id',projectId).maybeSingle();
  if(version.error || !version.data) return {error:'Версия недоступна.'};
  const scene=await supabase.from('scenes').select('id').eq('id',sceneId).eq('script_version_id',versionId).maybeSingle();
  if(scene.error || !scene.data) return {error:'Сцена недоступна.'};
  const {data,error}=await supabase.rpc('save_scene_shots',{p_version_id:versionId,p_scene_id:sceneId,p_shots:payload,p_expected_narration:expectedNarration});
  if(error) return {error:error.code==='PGRST202' ? shotsMigrationMessage : error.message.includes('SCENE_CHANGED') ? 'Озвучка эпизода изменилась в другой вкладке. Скопируйте правки и обновите страницу для сверки.' : error.message.includes('Too many shots') ? 'На версию допустимо до 240 кадров. Сократите план.' : 'Не удалось сохранить кадры. Правки остались в редакторе; проверьте сохранённый план перед повтором.'};
  const shots=shotsPayload(data);
  if(!shots) return {error:'Ответ сохранения не распознан. Проверьте результат после обновления страницы.'};
  revalidatePath(`/projects/${projectId}/scenes`);
  revalidatePath(`/projects/${projectId}/scenes/${sceneId}`);
  revalidatePath(`/projects/${projectId}/export`);
  return {error:'',shots};
 } catch {return {error:'Соединение прервано или доступ истёк. Правки остались в редакторе.'};}
}
