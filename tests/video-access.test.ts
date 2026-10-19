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
