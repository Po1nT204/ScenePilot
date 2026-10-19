import { videoContext } from '@/lib/production/context';
import { assertScope, readJob } from '@/lib/production/store';
import { clipMaxBytes, importClip } from '@/lib/production/clips';
import { publicJob } from '@/lib/production/model';
import { validUploadOrigin } from '@/lib/production/upload-origin';
import { VideoAccessError } from '@/lib/production/access-error';
import { unstable_rethrow } from 'next/navigation';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const url = new URL(request.url);
  if (!validUploadOrigin(request)) return Response.json({ error: 'Адрес загрузки не совпадает с адресом приложения. Откройте ScenePilot через http://127.0.0.1:3000 и выберите файл заново.' }, { status: 403 });
  const { id, jobId } = await context.params;
  try {
    const { scope } = await videoContext(id, url.searchParams.get('version') || '');
    const existing = await readJob(jobId); assertScope(existing, scope);
    const revision = Number(url.searchParams.get('revision'));
    if (!url.searchParams.has('revision') || !Number.isSafeInteger(revision) || revision !== existing.revision || ['queued', 'running'].includes(existing.status)) throw new Error('Сборка занята или изменилась. Обновите состояние.');
    if (Number(request.headers.get('content-length')) > clipMaxBytes) throw new Error('MP4 должен быть не больше 32 МиБ.');
    const reader = request.body?.getReader(); if (!reader) throw new Error('Файл не получен.');
    let size = 0; const chunks: Uint8Array[] = []; let expired = false;
    const timer = setTimeout(() => { expired = true; void reader.cancel(); }, 60000);
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length; if (size > clipMaxBytes) throw new Error('MP4 должен быть не больше 32 МиБ.');
        chunks.push(part.value);
      }
      if (expired) throw new Error('Загрузка превысила минуту. Попробуйте файл меньшего размера.');
    } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
    const job = await importClip(jobId, scope, revision, url.searchParams.get('shot') || '', Buffer.concat(chunks), undefined);
    return Response.json({ job: publicJob(job) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    unstable_rethrow(e);
    const error = e instanceof Error && !('code' in e) && !(e instanceof SyntaxError) ? e.message : 'Не удалось сохранить MP4. Проверьте файл и свободное место.';
    return Response.json({ error }, { status: e instanceof VideoAccessError ? 503 : 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
