import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { videoContext } from '@/lib/production/context';
import { readJob, assertScope, assetFile } from '@/lib/production/store';
import { byteRange } from '@/lib/production/range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string; jobId: string; file: string }> }) {
  const { id, jobId, file } = await params;
  const url = new URL(request.url);
  const { scope } = await videoContext(id, url.searchParams.get('version') || '');
  try {
    const job = await readJob(jobId); assertScope(job, scope);
    const path = assetFile(job, file), info = await stat(path);
    const range = byteRange(request.headers.get('range'), info.size);
    if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}`, 'Cache-Control': 'no-store' } });
    const type = file.endsWith('.mp4') ? 'video/mp4' : file.endsWith('.mp3') ? 'audio/mpeg' : file.endsWith('.jpg') ? 'image/jpeg' : 'application/x-subrip';
    const headers: Record<string, string> = { 'Content-Type': type, 'Content-Length': String(range.end - range.start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    if (request.headers.has('range')) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
    if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="scenepilot-${file}"`;
    const stream = createReadStream(path, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: request.headers.has('range') ? 206 : 200, headers });
  } catch { return new Response('Материал не найден или недоступен.', { status: 404, headers: { 'Cache-Control': 'no-store' } }); }
}
