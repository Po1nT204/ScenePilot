import {notFound} from 'next/navigation';
import {requireProjectUser} from '@/lib/projects/server';
import {isProjectId} from '@/lib/projects/validation';
import {ProjectWorkspace} from '@/components/project-workspace';
import {PublicationEditor} from '@/components/publication-editor';
import {publicationColumns,publicationPayload,publicationMigrationMessage} from '@/lib/publication';
import {sourceLabel} from '@/lib/export';
import {yandexReady} from '@/lib/ai/yandex';
export const dynamic = 'force-dynamic';
export const metadata = {title:'Публикация — ScenePilot'};

export default async function PublicationPage({params,searchParams}: {params:Promise<{id:string}>;searchParams:Promise<{version?:string}>}) {
 const {id} = await params; const {version:versionId} = await searchParams;
 if (!isProjectId(id) || !versionId || !isProjectId(versionId)) notFound();
 const {supabase,user} = await requireProjectUser();
 const project = await supabase.from('projects').select('title').eq('id',id).eq('owner_id',user.id).maybeSingle();
 if (project.error) throw new Error('Project unavailable'); if (!project.data) notFound();
 const version = await supabase.from('script_versions').select('id,version_number,content,source').eq('id',versionId).eq('project_id',id).maybeSingle();
 if (version.error) throw new Error('Version unavailable'); if (!version.data) notFound();
 const saved = await supabase.from('publication_materials').select(publicationColumns).eq('script_version_id',versionId).maybeSingle();
 const initial = publicationPayload(saved.data);
 const error = saved.error ? (['42P01','PGRST205'].includes(saved.error.code) ? publicationMigrationMessage : 'Не удалось загрузить сохранённые материалы. Обновите страницу позже.') : saved.data && !initial ? 'Сохранённые материалы имеют неверный формат.' : '';
 return <><ProjectWorkspace projectId={id} title={project.data.title} current="publication" version={version.data} />
  <section className="project-editor">
   <h2>Заголовок и описание</h2>
   <p>Материалы для версии {version.data.version_number}. Здесь вы готовите текст для переноса на YouTube самостоятельно.</p>
   <p>Источник сценария: {sourceLabel(version.data.source)}. Проверьте факты и соответствие описания содержанию ролика.</p>
   <details><summary>Сценарий, по которому готовятся материалы</summary><p className="project-full-topic">{version.data.content}</p></details>
   {error ? <p role="alert">{error}</p> : <PublicationEditor key={versionId} projectId={id} versionId={versionId} initial={initial} yandexEnabled={yandexReady()} />}
  </section>
 </>;
}
