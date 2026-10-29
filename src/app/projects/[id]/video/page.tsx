import { ProjectWorkspace } from '@/components/project-workspace';
import { VideoStudio } from '@/components/video-studio';
import { videoContext } from '@/lib/production/context';
import { videoState } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = { title: 'Видео — ScenePilot' };
export default async function VideoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const { id } = await params;
  const { version: versionId = '' } = await searchParams;
  const { project, version } = await videoContext(id, versionId);
  const state = await videoState(id, versionId);
  return <><ProjectWorkspace projectId={id} title={project.title} current="video" version={version} />
    {'error' in state ? <p role="alert">{state.error}</p> : <VideoStudio projectId={id} versionId={versionId} script={version.content} scriptSource={version.source || 'unknown'}
      initialJobs={state.jobs!} initialSetup={state.setup!} planningPace={version.settings_snapshot?.narration_pace} defaultVoice={process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'} />}
  </>;
}
