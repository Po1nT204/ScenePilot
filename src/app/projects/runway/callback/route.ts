import { cookies } from 'next/headers';
import { requireProjectUser } from '@/lib/projects/server';
import { videoContext } from '@/lib/production/context';
import { pendingRunway, finishRunway, runwayCookie } from '@/lib/production/runway-connect';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const { user } = await requireProjectUser();
  const jar = await cookies(), url = new URL(request.url);
  const state = url.searchParams.get('state') || '', browserState = jar.get(runwayCookie)?.value || '';
  try {
    const pending = await pendingRunway(user.id, state, browserState);
    await videoContext(pending.projectId, pending.versionId);
    if (url.searchParams.has('error')) throw new Error('Declined');
    await finishRunway(user.id, state, browserState, url.searchParams.get('code') || '');
    jar.set(runwayCookie, '', { path: '/projects', maxAge: 0 });
    return new Response(null, { status: 303, headers: { Location: `http://127.0.0.1:3000/projects/${pending.projectId}/video?version=${pending.versionId}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch {
    jar.set(runwayCookie, '', { path: '/projects', maxAge: 0 });
    return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Подключение Runway</title><body><h1>Подключение Runway не завершено</h1><p>Вход отменён, истёк или сервис не подтвердил доступ. Вернитесь в проект и начните подключение заново. Генерация не запускалась.</p><a href="/projects">Вернуться к проектам</a></body></html>', { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" } });
  }
}
