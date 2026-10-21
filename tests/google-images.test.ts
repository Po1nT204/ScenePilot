import assert from 'node:assert/strict';
import test from 'node:test';
import { googleImages } from '../src/lib/production/google-images';
import { imageCatalog } from '../src/lib/production/image-catalog';
import { imageAdapter, imageAvailability } from '../src/lib/production/image-registry';
import { ProviderError } from '../src/lib/production/providers';
const model = imageCatalog['google-nano-banana-21'].model;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(40)]);
const payload = () => ({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: png.toString('base64') }] }] });
test('Nano uses bounded synchronous Interactions request, header key, one image and no storage/tools', async () => {
  let calls = 0;
  const adapter = googleImages('secret', async (url, options) => {
    calls++; assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(new Headers(options?.headers).get('x-goog-api-key'), 'secret'); assert.equal(options?.redirect, 'error');
    const body = JSON.parse(String(options?.body)); assert.equal(body.model, model); assert.equal(body.store, false);
    assert.equal(body.response_format.aspect_ratio, '16:9'); assert.equal(body.response_format.image_size, '1K');
    assert.equal(body.tools, undefined); assert.equal(body.input[0].text, 'A forest');
    return Response.json(payload());
  });
  const result = await adapter.submit('A forest'); assert.equal(result.pending, false);
  if (!result.pending) { assert.deepEqual(result.bytes, png); assert.equal(result.extension, 'png'); }
  assert.equal(calls, 1);
});
test('connection only reads model metadata and does not imply generation quota', async () => {
  let calls = 0;
  const result = await googleImages('key', async (url, init) => {
    calls++; assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${model}`);
    return Response.json({ name: `models/${model}` });
  }).checkConnection();
  assert.equal(calls, 1); assert.match(result.message, /не проверка генерации/);
  assert.equal(imageAvailability({ enabled: true, bflKey: '', elevenKey: '' })['google-nano-banana-21'], false);
  assert.equal(imageAdapter('google-nano-banana-21', { enabled: true, bflKey: '', elevenKey: '', geminiKey: 'key' }).configured, true);
});
test('Nano rejects uncertain outcomes, unsafe remote image and invalid bytes without retrying', async () => {
  for (const body of [{ status: 'in_progress' }, { status: 'completed', steps: [{ type: 'thought', content: payload().steps[0].content }] },
    { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', uri: 'https://evil.test/image.png' }] }] },
    { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: 'YWJj' }] }] }]) {
    let calls = 0; await assert.rejects(googleImages('key', async () => { calls++; return Response.json(body); }).submit('x'), e => e instanceof ProviderError && e.uncertain);
    assert.equal(calls, 1);
  }
  for (const status of [403, 429, 500]) {
    let calls = 0; await assert.rejects(googleImages('key', async () => { calls++; return new Response('secret', { status }); }).submit('x'), e => e instanceof ProviderError && e.uncertain === (status === 500) && !e.message.includes('secret'));
    assert.equal(calls, 1);
  }
  await assert.rejects(googleImages('key', async () => { throw new Error('secret'); }).submit('x'), e => e instanceof ProviderError && e.uncertain && !e.message.includes('secret'));
  await assert.rejects(googleImages('key', async () => new Response('{}', { headers: { 'content-length': String(25 * 1024 * 1024) } })).submit('x'), e => e instanceof ProviderError && e.uncertain);
});
