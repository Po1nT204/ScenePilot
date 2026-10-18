import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJob, readJob, editJob, listJobs, queueOperation, assertScope, assetFile, jobDirectory, withLock } from '../src/lib/production/store';
import { planShots, parseAlignment, makeSubtitles, estimatedCost, requiredProviders, publicJob, type Alignment } from '../src/lib/production/model';
import { processJob, recoverJob, type ProductionServices } from '../src/lib/production/processor';
import { synthesize, submitImage, checkImage, ProviderError, pollingURL, imageURL } from '../src/lib/production/providers';
import { byteRange } from '../src/lib/production/range';
import { checkSpeechConnection } from '../src/lib/production/connection';

const scope = { ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() };
const input = { title: 'Pilot', script: 'A quiet city. The sun rises. People open their windows.', source: 'manual', voiceId: 'testVoice' };
function alignment(text: string): Alignment {
  return { characters: text.split(''), character_start_times_seconds: text.split('').map((_, i) => i * 0.05), character_end_times_seconds: text.split('').map((_, i) => (i + 1) * 0.05) };
}
async function sandbox(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'scenepilot-production-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function fakeServices(calls: string[]): ProductionServices {
  return { config: { enabled: true, elevenKey: 'test', bflKey: 'test' },
    speech: async text => { calls.push('speech'); return { bytes: Buffer.from('fixture audio'), alignment: alignment(text) }; },
    submit: async () => { calls.push('submit'); return { requestId: randomUUID(), pollingUrl: 'https://api.bfl.ai/v1/get_result?id=test' }; },
    check: async () => { calls.push('check'); return { pending: false, bytes: Buffer.from('fixture image') }; },
    render: async () => { calls.push('render'); return { output: `${randomUUID()}.mp4`, subtitles: `${randomUUID()}.srt` }; },
    sleep: async () => {},
  };
}

test('automatic plan covers the entire narration in order without loss', () => {
  const text = '  Привет, мир!\nЭто второй абзац.  И ещё немного слов.  ';
  const shots = planShots(text);
  assert.equal(shots.map(s => s.text).join(' '), text.trim().replace(/\s+/g, ' '));
  for (const shot of shots) assert.equal(text.trim().replace(/\s+/g, ' ').slice(shot.start, shot.end), shot.text);
  assert.throws(() => planShots('a'.repeat(5001)));
  assert.equal(planShots('One').length, 1);
});
test('alignment rejects mismatched text and backwards timestamps; subtitles use speech timing', () => {
  const text = 'First word. Second word.';
  const a = alignment(text);
  const srt = makeSubtitles(text, a);
  assert.match(srt, /00:00:00,000 --> 00:00:01,200/);
  assert.match(srt, /First word\. Second word\./);
  assert.throws(() => parseAlignment(a, text + '!'));
  a.character_start_times_seconds[3] = -1;
  assert.throws(() => parseAlignment(a, text));
});
test('local jobs isolate owner, project and version; edits reject stale revisions and paths', async () => sandbox(async root => {
  const job = await createJob(scope, input, root);
  assert.equal((await listJobs(scope, root)).length, 1);
  assert.equal((await listJobs({ ...scope, ownerId: randomUUID() }, root)).length, 0);
  for (const key of ['ownerId', 'projectId', 'versionId'] as const) assert.throws(() => assertScope(job, { ...scope, [key]: randomUUID() }));
  await assert.rejects(editJob(job.id, scope, 0, () => {}, root), /изменилось/);
  await editJob(job.id, scope, job.revision, j => { j.shots[0].prompt = 'new'; }, root);
  assert.equal((await readJob(job.id, root)).shots[0].prompt, 'new');
  assert.throws(() => jobDirectory('../outside', root));
  assert.throws(() => assetFile(job, '../../secret', root));
  assert.throws(() => assetFile(job, `${randomUUID()}.mp4`, root));
}));
test('confirmation and budget required; a live lock cannot be stolen', async () => sandbox(async root => {
  const job = await createJob(scope, input, root);
  assert.throws(() => queueOperation(job, { kind: 'generate', budgetUSD: 1, reservedUSD: 0 }, false));
  assert.throws(() => queueOperation(job, { kind: 'generate', budgetUSD: 0, reservedUSD: 0 }, true));
  const file = join(root, 'test.lock');
  await withLock(file, async () => { await assert.rejects(withLock(file, async () => {}), /занята/); });
  await withLock(file, async () => {});
}));
test('complete production preserves materials; render and single image replacement do not repeat speech', async () => sandbox(async root => {
  const job = await createJob(scope, input, root), calls: string[] = [];
  const deps = fakeServices(calls);
  queueOperation(job, { kind: 'generate', budgetUSD: 1, reservedUSD: 0 }, true);
  await processJob(job, root, deps);
  assert.equal(job.status, 'materials');
  assert.equal(calls.filter(c => c === 'speech').length, 1);
  assert.equal(calls.filter(c => c === 'submit').length, job.shots.length);
  assert.equal(estimatedCost(job, 'generate'), 0);
  const files = job.shots.map(s => s.image.file), audio = job.audio.file;
  const attempts = job.attempts.length;
  queueOperation(job, { kind: 'render', budgetUSD: 0, reservedUSD: 0 }, false);
  await processJob(job, root, deps);
  assert.equal(job.status, 'ready'); assert.equal(job.attempts.length, attempts);
  queueOperation(job, { kind: 'replace', shotId: job.shots[0].id, budgetUSD: 0.04, reservedUSD: 0 }, true);
  await processJob(job, root, deps);
  assert.equal(job.audio.file, audio); assert.equal(calls.filter(c => c === 'speech').length, 1);
  assert.notEqual(job.shots[0].image.file, files[0]);
  assert.deepEqual(job.shots.slice(1).map(s => s.image.file), files.slice(1));
  assert.equal(job.outputStale, true);
  assert.equal((await readFile(join(jobDirectory(job.id, root), audio!))).toString(), 'fixture audio');
}));
test('disabled generation never sends a request', async () => sandbox(async root => {
  const job = await createJob(scope, input, root), calls: string[] = [];
  const deps = fakeServices(calls); deps.config.enabled = false;
  queueOperation(job, { kind: 'generate', budgetUSD: 1, reservedUSD: 0 }, true);
  await processJob(job, root, deps);
  assert.deepEqual(calls, []); assert.equal(job.status, 'failed'); assert.equal(job.attempts.length, 0);
}));
test('timeout is persisted as unknown and cannot automatically resubmit speech', async () => sandbox(async root => {
  const job = await createJob(scope, input, root), calls: string[] = [];
  const deps = fakeServices(calls); deps.speech = async () => { calls.push('speech'); throw new ProviderError('timeout', true); };
  queueOperation(job, { kind: 'generate', budgetUSD: 1, reservedUSD: 0 }, true);
  await processJob(job, root, deps);
  const saved = await readJob(job.id, root);
  assert.equal(saved.audio.state, 'unknown'); assert.equal(saved.attempts.length, 1);
  assert.throws(() => queueOperation(saved, { kind: 'generate', budgetUSD: 1, reservedUSD: 0 }, true), /неизвестен/);
  assert.deepEqual(calls, ['speech']);
}));
test('interrupted image is recovered by checking its task without a new POST', async () => sandbox(async root => {
  const job = await createJob(scope, input, root), calls: string[] = [];
  job.status = 'running';
  job.audio.state = 'requesting';
  job.shots[0].image = { state: 'requesting', pollingUrl: 'https://api.bfl.ai/v1/get_result?id=test' };
  assert.equal(recoverJob(job), true);
  assert.equal(job.audio.state, 'unknown'); assert.equal(job.shots[0].image.state, 'pending');
  const view = publicJob(job);
  assert.ok(!JSON.stringify(view).includes('pollingUrl'));
  assert.equal(estimatedCost(view, 'check'), 0);
  queueOperation(job, { kind: 'check', budgetUSD: 0, reservedUSD: 0 }, false);
  await processJob(job, root, fakeServices(calls));
  assert.deepEqual(calls, ['check']); assert.ok(job.shots[0].image.file);
}));
test('budget is checked again at each provider call', async () => sandbox(async root => {
  const job = await createJob(scope, input, root), calls: string[] = [];
  queueOperation(job, { kind: 'generate', budgetUSD: 1, reservedUSD: 0 }, true);
  job.operation!.budgetUSD = 0.01;
  await processJob(job, root, fakeServices(calls));
  assert.equal(calls.filter(c => c === 'submit').length, 0);
  assert.equal(job.status, 'failed');
}));
test('provider errors do not retry or expose response bodies; URLs are restricted', async () => {
  let calls = 0;
  const transport = (async () => { calls++; return new Response('private provider data', { status: 500 }); }) as typeof fetch;
  await assert.rejects(synthesize('Hello', 'testVoice', 'secret', transport), /HTTP 500/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(submitImage('scene', 'secret', transport), /HTTP 500/);
  assert.equal(calls, 1);
  assert.throws(() => pollingURL('https://api.bfl.ai.evil.test/v1/get_result'));
  assert.throws(() => imageURL('http://127.0.0.1/private'));
  assert.throws(() => imageURL('https://evil.test/sample.jpg'));
  assert.equal(pollingURL('https://api.us1.bfl.ai/v1/get_result?id=a'), 'https://api.us1.bfl.ai/v1/get_result?id=a');
});
test('provider payload and response handling work with documented timestamp and async formats', async () => {
  const text = 'Hello.';
  const bytes = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]);
  const speech = await synthesize(text, 'testVoice', 'test', (async (url, init) => {
    assert.match(String(url), /with-timestamps/);
    assert.equal(JSON.parse(init!.body as string).model_id, 'eleven_multilingual_v2');
    return Response.json({ audio_base64: bytes.toString('base64'), alignment: alignment(text) });
  }) as typeof fetch);
  assert.deepEqual(speech.bytes, bytes);
  const submitted = await submitImage('scene', 'test', (async (_url, init) => {
    assert.equal(JSON.parse(init!.body as string).output_format, 'jpeg');
    assert.equal(JSON.parse(init!.body as string).height % 32, 0);
    assert.equal(JSON.parse(init!.body as string).width % 32, 0);
    return Response.json({ id: 'task', polling_url: 'https://api.bfl.ai/v1/get_result?id=task' });
  }) as typeof fetch);
  let calls = 0;
  const image = await checkImage(submitted.pollingUrl, 'test', (async (_url, init) => {
    calls++; if (calls === 1) return Response.json({ status: 'Ready', result: { sample: 'https://delivery-eu1.bfl.ai/file.jpg' } });
    assert.ok(!init?.headers); // Provider API key never goes to image storage.
    return new Response(new Uint8Array([255, 216, 255, 10]));
  }) as typeof fetch);
  assert.equal(image.pending, false); assert.equal(calls, 2);
});
test('range requests support seeking and reject malformed or out-of-bounds requests', () => {
  assert.deepEqual(byteRange('bytes=2-4', 10), { start: 2, end: 4 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange('bytes=3-', 10), { start: 3, end: 9 });
  for (const value of ['bytes=10-', 'bytes=-0', 'bytes=8-3', 'bytes=1-2,5-6', 'bytes=-']) assert.equal(byteRange(value, 10), null);
});
test('a stale process lock can be reclaimed', async () => sandbox(async root => {
  const file = join(root, 'stale.lock'); await writeFile(file, '2147483647');
  await withLock(file, async () => {});
}));

test('speech-only works without BFL and later full production reuses the saved audio', async () => sandbox(async root => {
  const job = await createJob(scope, input, root), calls: string[] = [];
  const deps = fakeServices(calls); deps.config.bflKey = '';
  assert.deepEqual(requiredProviders(job, 'speech'), { speech: true, images: false });
  const cost = estimatedCost(job, 'speech');
  assert.ok(cost > 0 && cost < estimatedCost(job, 'generate'));
  assert.throws(() => queueOperation(job, { kind: 'speech', budgetUSD: cost, reservedUSD: 0 }, false), /Подтвердите/);
  assert.throws(() => queueOperation(job, { kind: 'speech', budgetUSD: cost / 2, reservedUSD: 0 }, true), /Подтвердите/);
  queueOperation(job, { kind: 'speech', budgetUSD: cost, reservedUSD: 0 }, true);
  await processJob(job, root, deps);
  assert.deepEqual(calls, ['speech']);
  const saved = await readJob(job.id, root), audio = saved.audio.file;
  assert.ok(audio); assert.ok(saved.alignment); assert.equal(saved.attempts.length, 1);
  assert.ok(saved.shots.every(s => s.image.state === 'empty'));
  queueOperation(saved, { kind: 'speech', budgetUSD: 0, reservedUSD: 0 }, false);
  await processJob(saved, root, deps);
  assert.deepEqual(calls, ['speech']); // Existing speech is never re-generated.
  assert.deepEqual(requiredProviders(saved, 'generate'), { speech: false, images: true });
  deps.config.bflKey = 'test'; deps.config.elevenKey = '';
  queueOperation(saved, { kind: 'generate', budgetUSD: 1, reservedUSD: 0 }, true);
  await processJob(saved, root, deps);
  assert.equal(saved.status, 'materials'); assert.equal(saved.audio.file, audio);
  assert.equal(calls.filter(c => c === 'speech').length, 1);
}));

test('speech-only uncertainty blocks repetition and disabled generation does not spend', async () => sandbox(async root => {
  const job = await createJob(scope, input, root), calls: string[] = [];
  const deps = fakeServices(calls); deps.config.enabled = false;
  queueOperation(job, { kind: 'speech', budgetUSD: 1, reservedUSD: 0 }, true);
  await processJob(job, root, deps);
  assert.equal(calls.length, 0); assert.equal(job.attempts.length, 0);
  // An unknown image must not prevent an independent speech request.
  job.shots[0].image.state = 'unknown'; deps.config.enabled = true;
  deps.speech = async () => { calls.push('speech'); throw new ProviderError('timeout', true); };
  queueOperation(job, { kind: 'speech', budgetUSD: 1, reservedUSD: 0 }, true);
  await processJob(job, root, deps);
  assert.equal(job.audio.state, 'unknown'); assert.deepEqual(calls, ['speech']);
  assert.throws(() => queueOperation(job, { kind: 'speech', budgetUSD: 1, reservedUSD: 0 }, true), /неизвестен/);
}));

test('connection check only reads metadata and returns a small allowlist', async () => {
  const urls: string[] = [];
  const result = await checkSpeechConnection('testVoice', 'fixture-key', (async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).get('xi-api-key'), 'fixture-key');
    return Response.json(urls.length === 1
      ? { tier: 'starter', character_count: 123, character_limit: 30000, open_invoices: ['private'] }
      : { voice_id: 'testVoice', name: 'Test voice', samples: ['private'], preview_url: 'https://untrusted.test/file' });
  }) as typeof fetch);
  assert.deepEqual(urls, ['https://api.elevenlabs.io/v1/user/subscription', 'https://api.elevenlabs.io/v1/voices/testVoice']);
  assert.equal(result.remainingCharacters, 29877); assert.equal(result.voiceName, 'Test voice');
  assert.ok(!JSON.stringify(result).includes('private')); assert.ok(!JSON.stringify(result).includes('fixture-key'));
  assert.deepEqual(Object.keys(result).sort(), ['checkedAt', 'remainingCharacters', 'tier', 'voiceId', 'voiceName']);
});

test('connection failures never retry, generate, expose response bodies or accept unsafe voice IDs', async () => {
  let calls = 0;
  const denied = (async () => { calls++; return new Response('SECRET response body', { status: 401 }); }) as typeof fetch;
  await assert.rejects(checkSpeechConnection('../user', 'fixture-key', denied), /Voice ID/);
  await assert.rejects(checkSpeechConnection('testVoice', '', denied), /ELEVENLABS_API_KEY/);
  assert.equal(calls, 0);
  await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', denied), error => {
    assert.match(String(error), /HTTP 401.*User: Read/); assert.ok(!String(error).includes('SECRET')); return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => { throw new Error('SECRET'); }) as typeof fetch), /Проверьте соединение/);
  await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => Response.json(null)) as typeof fetch), /некорректные/);
  await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => Response.json({ tier: 'starter', character_count: -1, character_limit: 10 })) as typeof fetch), /квоте/);
  let n = 0;
  await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => Response.json(++n === 1
    ? { tier: 'starter', character_count: 0, character_limit: 10 } : { voice_id: 'otherVoice' })) as typeof fetch), /Voice ID/);
});

test('connection diagnostics distinguish header, network and non-JSON failures without secrets', async () => {
  let calls = 0;
  await assert.rejects(checkSpeechConnection('testVoice', 'ключ\nSECRET', (async () => { calls++; return Response.json({}); }) as typeof fetch), /формат ELEVENLABS_API_KEY/);
  assert.equal(calls, 0);
  for (const [code, hint] of [['ENOTFOUND', /DNS/], ['ECONNRESET', /сброшено/], ['CERT_HAS_EXPIRED', /сертификата/], ['UND_ERR_CONNECT_TIMEOUT', /время ожидания/]] as const) {
    await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => {
      calls++; throw new TypeError('SECRET proxy URL', { cause: new AggregateError([Object.assign(new Error('SECRET'), { code })]) });
    }) as typeof fetch), error => { assert.match(String(error), hint); assert.match(String(error), /проверка подписки/); assert.ok(!String(error).includes('SECRET')); return true; });
  }
  assert.equal(calls, 4);
  await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => { throw new DOMException('SECRET', 'TimeoutError'); }) as typeof fetch), /время ожидания/);
  let n = 0;
  await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => ++n === 1
    ? Response.json({ tier: 'free', character_count: 0, character_limit: 10000 })
    : new Response('<html>SECRET proxy login</html>')) as typeof fetch), error => {
    assert.match(String(error), /проверка голоса.*HTTP 200.*не является JSON/); assert.ok(!String(error).includes('SECRET')); return true;
  });
  assert.equal(n, 2);
});

test('voice rejection explains known provider codes in both formats without leaking messages', async () => {
  for (const detail of [{ status: 'voice_not_found', message: 'SECRET' }, { code: 'voice_not_found', message: 'SECRET' }]) {
    let calls = 0;
    await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => ++calls === 1
      ? Response.json({ tier: 'free', character_count: 0, character_limit: 10000 })
      : Response.json({ detail }, { status: 400 })) as typeof fetch), error => {
      assert.match(String(error), /проверка голоса.*HTTP 400.*voice_not_found.*My Voices.*новую сборку/);
      assert.ok(!String(error).includes('SECRET')); return true;
    });
    assert.equal(calls, 2);
  }
  for (const detail of [{ code: 'SECRET', message: 'SECRET' }, { code: 'constructor' }, { code: '__proto__' }]) {
    await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => Response.json({ detail }, { status: 400 })) as typeof fetch), error => {
      assert.match(String(error), /API отклонил запрос/); assert.ok(!String(error).includes('SECRET')); return true;
    });
  }
  await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => Response.json({ detail: { code: 'missing_permission', message: 'SECRET' } }, { status: 400 })) as typeof fetch), /missing_permission.*User: Read/);
  await assert.rejects(checkSpeechConnection('testVoice', 'fixture-key', (async () => new Response('x'.repeat(65000), { status: 400 })) as typeof fetch), /HTTP 400.*API отклонил запрос/);
});
