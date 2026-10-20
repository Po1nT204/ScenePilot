import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { validUploadOrigin } from '../src/lib/production/upload-origin';
import { supabaseTransport } from '../src/lib/supabase/network';

test('clip upload accepts actual loopback Host even when Next reconstructs a different URL', () => {
  const request = (host: string, origin: string) => new Request('http://localhost:3000/projects/fixture/video/clips/id', { method: 'POST', headers: { host, origin } });
  assert.equal(validUploadOrigin(request('127.0.0.1:3000', 'http://127.0.0.1:3000')), true);
  assert.equal(validUploadOrigin(request('localhost:3000', 'http://localhost:3000')), true);
  assert.equal(validUploadOrigin(request('[::1]:3000', 'http://[::1]:3000')), true);
  for (const origin of ['https://evil.example', 'null', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://localhost:3000/path', 'http://user@localhost:3000']) {
    assert.equal(validUploadOrigin(request('localhost:3000', origin)), false, origin);
  }
  assert.equal(validUploadOrigin(request('evil.example', 'http://evil.example')), false);
  assert.equal(validUploadOrigin(new Request('http://localhost:3000', { headers: { 'x-forwarded-host': 'localhost:3000', origin: 'http://localhost:3000' } })), false);
  assert.equal(validUploadOrigin(new Request('http://localhost:3000', { headers: { host: 'localhost:3000' } })), false);
});

test('Supabase requests disable fetch cache, preserve credentials/options and never retry a failed write', async () => {
  let calls = 0;
  const send = supabaseTransport(async (_url, init) => {
    calls++;
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.method, 'POST'); assert.equal(init?.body, 'fixture');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture');
    assert.ok(init?.signal);
    throw new TypeError('fixture connection reset');
  });
  await assert.rejects(send('https://example.test', { method: 'POST', body: 'fixture', headers: { Authorization: 'Bearer fixture' } }));
  assert.equal(calls, 1);
});

test('Supabase request deadline and caller cancellation are both retained', async () => {
  let signal: AbortSignal | undefined | null;
  const transport = supabaseTransport(async (_input, init) => { signal = init?.signal; return new Response('fixture'); }, 15);
  const caller = new AbortController();
  await transport(new Request('https://example.test', { signal: caller.signal }));
  assert.equal(signal?.aborted, false); caller.abort(); assert.equal(signal?.aborted, true);
  await transport('https://example.test'); assert.equal(signal?.aborted, false);
  await delay(30); assert.equal(signal?.aborted, true);
});

test('Supabase retries a transient table read once with the same filters and credentials', async t => {
  const logs: string[] = [];
  t.mock.method(console, 'warn', (value: string) => logs.push(value));
  let calls = 0;
  const url = 'https://db.example.test/rest/v1/channel_profiles?owner_id=eq.PRIVATE';
  const send = supabaseTransport(async (input, init) => {
    calls++; assert.equal(input, url);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer PRIVATE');
    assert.equal(init?.cache, 'no-store');
    if (calls === 1) throw new TypeError('PRIVATE connection reset');
    return Response.json([{ name: 'Recovered' }]);
  });
  assert.deepEqual(await (await send(url, { headers: { Authorization: 'Bearer PRIVATE' } })).json(), [{ name: 'Recovered' }]);
  assert.equal(calls, 2);
  assert.equal(logs.length, 1);
  assert.ok(!logs.join().includes('PRIVATE'));
});

test('Supabase auth GET recovers after gateway error but never retries authorization or schema errors', async t => {
  t.mock.method(console, 'warn', () => {});
  let calls = 0;
  const send = supabaseTransport(async () => ++calls === 1 ? new Response('gateway', { status: 503 }) : Response.json({ id: 'fixture' }));
  assert.equal((await send('https://db.example.test/auth/v1/user')).status, 200);
  assert.equal(calls, 2);
  for (const status of [400, 401, 403, 404, 429]) {
    calls = 0;
    const fail = supabaseTransport(async () => { calls++; return new Response('', { status }); });
    assert.equal((await fail('https://db.example.test/rest/v1/channel_profiles')).status, status);
    assert.equal(calls, 1);
  }
});

test('Supabase never retries writes, auth refresh or RPC calls including GET RPC', async t => {
  t.mock.method(console, 'warn', () => {});
  for (const [path, method] of [['/rest/v1/projects','POST'], ['/rest/v1/channel_profiles','PATCH'], ['/rest/v1/projects','DELETE'], ['/auth/v1/token','POST'], ['/rest/v1/rpc/save_script','GET'], ['/rest/v1/rpc/save_script','POST']]) {
    let calls = 0;
    const send = supabaseTransport(async () => { calls++; throw new TypeError('reset'); });
    await assert.rejects(send(new Request('https://db.example.test'+path, { method })));
    assert.equal(calls, 1, `${method} ${path}`);
  }
});

test('Supabase read retries stop after two attempts and respect caller cancellation', async t => {
  t.mock.method(console, 'warn', () => {});
  let calls = 0;
  const send = supabaseTransport(async () => { calls++; throw new TypeError('reset'); });
  await assert.rejects(send('https://db.example.test/rest/v1/projects'));
  assert.equal(calls, 2);
  calls = 0;
  const caller = new AbortController();
  const cancelled = supabaseTransport(async () => { calls++; caller.abort(); throw caller.signal.reason; });
  await assert.rejects(cancelled('https://db.example.test/auth/v1/user', { signal: caller.signal }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(send('https://db.example.test/rest/v1/projects', { signal: caller.signal }));
  assert.equal(calls, 0);
});

test('Supabase read deadline allows one recovery attempt without extending the total budget', async t => {
  t.mock.method(console, 'warn', () => {});
  let calls = 0;
  const send = supabaseTransport(async (_input, init) => {
    calls++;
    if (calls === 2) return Response.json({ recovered: true });
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
  }, 100);
  // Keep the test event loop alive while AbortSignal's unref'ed deadline expires.
  const [response] = await Promise.all([send('https://db.example.test/rest/v1/projects'), delay(120)]);
  assert.equal(calls, 2);
  assert.deepEqual(await response.json(), { recovered: true });
});
