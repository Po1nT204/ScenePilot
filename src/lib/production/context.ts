import 'server-only';
import { notFound } from 'next/navigation';
import { requireProjectUser } from '../projects/server';
import { validJobId } from './store';

export async function videoContext(projectId: string, versionId: string) {
  const { supabase, user } = await requireProjectUser();
  if (!validJobId(projectId) || !validJobId(versionId)) notFound();
  const project = await supabase.from('projects').select('id,title').eq('id', projectId).eq('owner_id', user.id).maybeSingle();
  if (project.error) throw new Error('Не удалось проверить доступ к проекту.');
  if (!project.data) notFound();
  const version = await supabase.from('script_versions').select('id,version_number,content,source').eq('id', versionId).eq('project_id', projectId).maybeSingle();
  if (version.error) throw new Error('Не удалось загрузить версию сценария.');
  if (!version.data) notFound();
  return { scope: { ownerId: user.id, projectId, versionId }, project: project.data, version: version.data };
}
