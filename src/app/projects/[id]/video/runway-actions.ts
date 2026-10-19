'use server';
import { cookies, headers } from 'next/headers';
import { videoContext } from '@/lib/production/context';
import { startRunway, runwayStatus, checkRunway, disconnectRunway, runwayCookie } from '@/lib/production/runway-connect';
function error(e: unknown) { return e instanceof Error && !('code' in e) && !(e instanceof SyntaxError) ? e.message : 'Не удалось сохранить подключение Runway.'; }
export async function connectRunwayAccount(projectId: string, versionId: string) {
  const { scope } = await videoContext(projectId, versionId);
  try {
    if ((await headers()).get('origin') !== 'http://127.0.0.1:3000') throw new Error('Для подключения Runway откройте ScenePilot по адресу http://127.0.0.1:3000.');
    const result = await startRunway(scope);
    (await cookies()).set(runwayCookie, result.state, { httpOnly: true, sameSite: 'lax', secure: false, path: '/projects', maxAge: 600 });
    return { url: result.url };
  } catch (e) { return { error: error(e) }; }
}
export async function getRunwayConnection(projectId: string, versionId: string) {
  const { scope } = await videoContext(projectId, versionId);
  try { return { status: await runwayStatus(scope.ownerId) }; } catch (e) { return { error: error(e) }; }
}
export async function inspectRunwayConnection(projectId: string, versionId: string) {
  const { scope } = await videoContext(projectId, versionId);
  try { return { status: await checkRunway(scope.ownerId) }; } catch (e) { return { error: error(e) }; }
}
export async function removeRunwayConnection(projectId: string, versionId: string) {
  const { scope } = await videoContext(projectId, versionId);
  try { await disconnectRunway(scope.ownerId); (await cookies()).set(runwayCookie, '', { path: '/projects', maxAge: 0 }); return { status: { connected: false } }; } catch (e) { return { error: error(e) }; }
}
