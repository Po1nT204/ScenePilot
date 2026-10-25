import { videoContext } from '@/lib/production/context';
import { assertScope, readJob } from '@/lib/production/store';
import { imageUploadMaxBytes, importImage } from '@/lib/production/image-import';
import { publicJob } from '@/lib/production/model';
import { validUploadOrigin } from '@/lib/production/upload-origin';
import { VideoAccessError } from '@/lib/production/access-error';
import { unstable_rethrow } from 'next/navigation';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  if (!validUploadOrigin(request)) return Response.json({ error: 'Адрес загрузки не совпадает с адресом ScenePilot.' }, { status: 403 });
  const url = new URL(request.url), { id, jobId } = await context.params;
  try {
    const { scope } = await videoContext(id, url.searchParams.get('version') || '');
    const existing = await readJob(jobId); assertScope(existing, scope);
    const revision = Number(url.searchParams.get('revision'));
    if (!url.searchParams.has('revision') || !Number.isSafeInteger(revision) || revision !== existing.revision || ['queued', 'running'].includes(existing.status)) throw new Error('Сборка занята или изменилась. Обновите состояние.');
    if (Number(request.headers.get('content-length')) > imageUploadMaxBytes) throw new Error('Выберите изображение до 16 МиБ.');
    const reader = request.body?.getReader(); if (!reader) throw new Error('Файл не получен.');
    let size = 0, expired = false; const chunks: Uint8Array[] = [];
    const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 60000);
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length; if (size > imageUploadMaxBytes) throw new Error('Выберите изображение до 16 МиБ.');
        chunks.push(part.value);
      }
      if (expired) throw new Error('Загрузка превысила минуту. Проверьте соединение.');
    } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
    const job = await importImage(jobId, scope, revision, url.searchParams.get('shot') || '', Buffer.concat(chunks));
    return Response.json({ job: publicJob(job) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error && !('code' in error) && !(error instanceof SyntaxError) ? error.message : 'Не удалось сохранить изображение. Проверьте файл и свободное место.';
    return Response.json({ error: message }, { status: error instanceof VideoAccessError ? 503 : 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
