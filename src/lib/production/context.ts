import 'server-only';
import { notFound, unstable_rethrow } from 'next/navigation';
import { requireProjectUser } from '../projects/server';
import { validJobId } from './store';
import { VideoAccessError } from './access-error';

export async function videoContext(projectId: string, versionId: string) {
  const { supabase, user } = await requireProjectUser().catch(e => { unstable_rethrow(e); throw new VideoAccessError(); });
  if (!validJobId(projectId) || !validJobId(versionId)) notFound();
  const project = await supabase.from('projects').select('id,title').eq('id', projectId).eq('owner_id', user.id).maybeSingle();
  if (project.error) throw new VideoAccessError();
  if (!project.data) notFound();
  const version = await supabase.from('script_versions').select('id,version_number,content,source,settings_snapshot').eq('id', versionId).eq('project_id', projectId).maybeSingle();
  if (version.error) throw new VideoAccessError();
  if (!version.data) notFound();
  return { supabase, scope: { ownerId: user.id, projectId, versionId }, project: project.data, version: version.data };
}
