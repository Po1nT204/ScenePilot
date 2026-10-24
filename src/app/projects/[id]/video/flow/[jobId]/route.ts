import { Readable } from 'node:stream';
import { unstable_rethrow } from 'next/navigation';
import { videoContext } from '@/lib/production/context';
import { prepareFlowExport } from '@/lib/production/flow-export';
import { streamZip } from '@/lib/production/zip';
import { VideoAccessError } from '@/lib/production/access-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await params, query = new URL(request.url).searchParams;
  try {
    const { scope } = await videoContext(id, query.get('version') || '');
    const revision = query.has('revision') ? Number(query.get('revision')) : NaN;
    const bundle = await prepareFlowExport(jobId, scope, revision, query.get('camera') || 'still');
    const stream = Readable.from(streamZip(bundle.entries), { objectMode: false });
    const body = Readable.toWeb(stream, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } });
    return new Response(body as ReadableStream, { headers: {
      'Content-Type': 'application/zip', 'Content-Length': String(bundle.size),
      'Content-Disposition': `attachment; filename="${bundle.filename}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error && !('code' in error) && !(error instanceof SyntaxError)
      ? error.message : 'Не удалось подготовить пакет. Проверьте доступность изображений.';
    return Response.json({ error: message }, { status: error instanceof VideoAccessError ? 503 : 400, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
