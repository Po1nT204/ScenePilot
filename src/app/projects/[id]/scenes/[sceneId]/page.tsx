import Link from 'next/link';
import {notFound} from 'next/navigation';
import {ProjectWorkspace} from '@/components/project-workspace';
import {ShotEditor} from '@/components/shot-editor';
import {requireProjectUser} from '@/lib/projects/server';
import {isProjectId} from '@/lib/projects/validation';
import {shotsPayload,shotsMigrationMessage} from '@/lib/shots';
export const dynamic='force-dynamic';
export const metadata={title:'Кадры эпизода — ScenePilot'};
export default async function ShotsPage({params,searchParams}:{params:Promise<{id:string;sceneId:string}>;searchParams:Promise<{version?:string}>}) {
 const {id,sceneId}=await params; const {version:versionId}=await searchParams;
 if(!isProjectId(id)||!isProjectId(sceneId)||!isProjectId(versionId)) notFound();
 const {supabase,user}=await requireProjectUser();
 const project=await supabase.from('projects').select('title').eq('id',id).eq('owner_id',user.id).maybeSingle();
 if(project.error) throw new Error('Project unavailable'); if(!project.data) notFound();
 const version=await supabase.from('script_versions').select('id,version_number,settings_snapshot').eq('id',versionId).eq('project_id',id).maybeSingle();
 if(version.error) throw new Error('Version unavailable'); if(!version.data) notFound();
 const scene=await supabase.from('scenes').select('position,description,narration,source').eq('id',sceneId).eq('script_version_id',versionId).maybeSingle();
 if(scene.error) throw new Error('Scene unavailable'); if(!scene.data) notFound();
 const [rows,plan,total]=await Promise.all([
  supabase.from('scene_shots').select('*').eq('scene_id',sceneId).eq('script_version_id',versionId).order('position'),
  supabase.from('scene_shot_plans').select('narration_snapshot').eq('scene_id',sceneId).eq('script_version_id',versionId).maybeSingle(),
  supabase.from('scene_shots').select('id',{count:'exact',head:true}).eq('script_version_id',versionId),
 ]);
 const initial=shotsPayload(rows.data);
 return <><ProjectWorkspace projectId={id} title={project.data.title} current="scenes" version={version.data}/><section className="scene-page">
  <Link href={`/projects/${id}/scenes?version=${versionId}`}>← К эпизодам версии {version.data.version_number}</Link>
  <h2>Кадры · эпизод {scene.data.position}</h2>
  {rows.error||plan.error||total.error||!initial ? <p role="alert">Кадры не загружены. {shotsMigrationMessage} Если она уже применена, проверьте соединение.</p> : <ShotEditor key={sceneId} projectId={id} versionId={versionId} sceneId={sceneId} initial={initial} narration={scene.data.narration} description={scene.data.description} sceneSource={scene.data.source} narrationSnapshot={plan.data?.narration_snapshot} otherCount={(total.count ?? 0)-initial.length} pace={version.data.settings_snapshot.narration_pace}/>}
 </section></>;
}
