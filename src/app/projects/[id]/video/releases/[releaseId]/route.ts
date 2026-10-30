import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { unstable_rethrow } from 'next/navigation';
import { videoContext } from '@/lib/production/context';
import { assertScope } from '@/lib/production/store';
import { readRelease, releaseFile } from '@/lib/production/release-store';
import { byteRange } from '@/lib/production/range';
import { VideoAccessError } from '@/lib/production/access-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string; releaseId: string }> }) {
  const { id, releaseId } = await params, url = new URL(request.url);
  try {
    const { scope } = await videoContext(id, url.searchParams.get('version') || '');
    const release = await readRelease(releaseId); assertScope(release, scope);
    const file = releaseFile(release), info = await stat(file), range = byteRange(request.headers.get('range'), info.size);
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}`, 'Cache-Control': 'no-store' } });
    const headers: Record<string, string> = { 'Content-Type': 'video/mp4', 'Content-Length': String(range.end - range.start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    if (request.headers.has('range')) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
    if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="scenepilot-release-${release.id}.mp4"`;
    const stream = createReadStream(file, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: request.headers.has('range') ? 206 : 200, headers });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof VideoAccessError) return new Response(error.message, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return new Response('Выпуск не найден или недоступен.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
}
