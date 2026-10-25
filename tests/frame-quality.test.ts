import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cloudflareImages } from '../src/lib/production/cloudflare-images';
import { imageCatalog } from '../src/lib/production/image-catalog';
import { imageAvailability } from '../src/lib/production/image-registry';
import { ProviderError } from '../src/lib/production/providers';
import { imageFileFormat, importImage } from '../src/lib/production/image-import';
import { imageFileProblem, suggestImageShot, framePromptForFlow, uploadFrameImage } from '../src/lib/production/frame-transfer';
import { flowFrameName, importFileBatch, assignmentProblems } from '../src/lib/production/flow-batch';
import { createJob, editJob, jobDirectory, queueOperation, readJob, selectImageProvider } from '../src/lib/production/store';
import { estimatedCost, publicJob, type VideoView } from '../src/lib/production/model';
import { processJob, type ProductionServices } from '../src/lib/production/processor';

const provider = 'cloudflare-flux2-klein9b', model = imageCatalog[provider].model;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(40)]);
const makeFile = (name = 'image.png') => new File([png], name, { type: 'image/png' });
const view = () => ({ id: '11111111-1111-4111-8111-111111111111', projectId: 'project', versionId: 'version', revision: 4,
  shots: [{ id: 'shot', image: { state: 'empty' }, text: 'Lake' }, { id: 'next', image: { state: 'empty' }, text: 'Forest' }] }) as VideoView;
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'sp-frame-quality-'));
  try { await run(root); } finally { assert.ok(root.startsWith(join(tmpdir(), 'sp-frame-quality-'))); await rm(root, { recursive: true, force: true }); }
}
const input = { title: 'Fixture', script: 'The boat crosses the lake. Birds fly above the forest.', source: 'test', voiceId: 'fixture' };
const scope = () => ({ ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() });

test('FLUX on Cloudflare checks the pinned model without generation and submits native multipart once', async () => {
  const calls: string[] = [];
  const adapter = cloudflareImages('a'.repeat(32), 'fixture', (async (url, init) => {
    calls.push(init!.method!); assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init!.headers).get('Authorization'), 'Bearer fixture');
    if (init?.method === 'GET') { assert.ok(String(url).includes(encodeURIComponent(model))); return Response.json({ success: true, result: [{ name: model }] }); }
    assert.ok(String(url).endsWith(`/run/${model}`)); assert.ok(init!.body instanceof FormData);
    assert.equal(new Headers(init!.headers).get('Content-Type'), null); // fetch must generate the multipart boundary
    assert.equal(init.body.get('width'), '1280'); assert.equal(init.body.get('height'), '720'); assert.equal(init.body.get('prompt'), 'A natural landscape');
    assert.equal(init.body.has('steps'), false);
    return Response.json({ success: true, result: { image: png.toString('base64') } });
  }) as typeof fetch, provider);
  assert.equal((await adapter.checkConnection()).provider, provider); assert.deepEqual(calls, ['GET']);
  const result = await adapter.submit('A natural landscape'); assert.equal(result.pending, false);
  if (!result.pending) { assert.deepEqual(result.bytes, png); assert.equal(result.extension, 'png'); }
  assert.deepEqual(calls, ['GET', 'POST']);
  assert.equal(imageAvailability({ enabled: true, bflKey: '', elevenKey: '', cloudflareAccountId: 'a'.repeat(32), cloudflareToken: 'fixture' })[provider], true);
});

test('FLUX rejects invalid receipts and quota/server failures without leaking provider text or retrying', async () => {
  for (const response of [Response.json({ success: false, errors: ['SECRET'] }), Response.json({ success: true, result: { image: 'SECRET' } }),
    new Response('SECRET', { status: 429 }), new Response('SECRET', { status: 503 }), new Response('', { headers: { 'Content-Length': '26000000' } })]) {
    let calls = 0;
    await assert.rejects(cloudflareImages('a'.repeat(32), 'fixture', (async () => { calls++; return response; }) as typeof fetch, provider).submit('test'), error => {
      assert.ok(error instanceof ProviderError); assert.ok(!error.message.includes('SECRET')); return true;
    }); assert.equal(calls, 1);
  }
  await assert.rejects(cloudflareImages('bad', 'fixture', (async () => { throw Error('must not call'); }) as typeof fetch, provider).submit('test'), /ACCOUNT/);
});

test('frame files require supported extensions, sizes, exact build names and unique assignments', () => {
  const job = view();
  assert.equal(suggestImageShot(`${flowFrameName(job.id, 0)} (2).PNG`, job), 'shot');
  assert.equal(suggestImageShot(`${flowFrameName(randomUUID(), 0)}.png`, job), '');
  assert.equal(suggestImageShot('frame-1.png', job), '');
  for (const name of ['a.zip', 'a.svg', 'a.mp4']) assert.ok(imageFileProblem(makeFile(name)));
  assert.ok(imageFileProblem({ name: 'a.png', size: 17 * 1024 * 1024 })); assert.ok(imageFileProblem({ name: 'a.png', size: 0 }));
  assert.ok(assignmentProblems([{key:'a',shotId:'shot',file:makeFile()}, {key:'b',shotId:'shot',file:makeFile()}],job,imageFileProblem).every(Boolean));
  const prompt = framePromptForFlow({visualStyle:'photo'}, 'Cinematic editorial illustration, coherent realistic style, landscape composition, no text or watermark. Depict this part of the story: A boat');
  assert.match(prompt, /Documentary photograph/); assert.match(prompt, /one standalone 16:9/); assert.ok(!prompt.includes('Cinematic editorial illustration'));
});

test('image transport requires a new uploaded asset receipt; sequential image import stops on uncertainty', async () => {
  const original = globalThis.fetch; const job = view(); let calls = 0;
  try {
    globalThis.fetch = (async (url, init) => { calls++; assert.match(String(url), /\/video\/images\//); assert.ok(String(url).includes('revision=4')); assert.equal(init?.redirect, 'error'); assert.ok(init?.body instanceof File); return Response.json({job:{...job,revision:5,shots:[{...job.shots[0],image:{state:'ready',file:'new.png',source:'upload'}}]}}); }) as typeof fetch;
    assert.equal((await uploadFrameImage('project','version',job,'shot',makeFile())).revision, 5); assert.equal(calls,1);
    globalThis.fetch = (async () => new Response('<html>login</html>', {headers:{'Content-Type':'text/html'}})) as typeof fetch;
    await assert.rejects(uploadFrameImage('project','version',job,'shot',makeFile()), /вход/);
    globalThis.fetch = (async () => Response.json({job:{...job,revision:5}})) as typeof fetch;
    await assert.rejects(uploadFrameImage('project','version',job,'shot',makeFile()), /подтверждение/);
  } finally { globalThis.fetch = original; }
  const revisions: number[] = []; const saved: string[] = [];
  const result = await importFileBatch(job, [{key:'a',shotId:'shot',file:makeFile()}, {key:'b',shotId:'next',file:makeFile()}], {
    validateFile:imageFileProblem, stop:()=>false, started:()=>{}, saved:row=>saved.push(row.key),
    upload:async current=>{ revisions.push(current.revision); if(revisions.length===2) throw Error('connection'); return {...current,revision:5}; },
  }); assert.equal(result.completed,1); assert.equal(result.failedKey,'b'); assert.deepEqual(revisions,[4,5]); assert.deepEqual(saved,['a']);
});

test('image import accepts raster signatures and rejects disguised content', () => {
  assert.equal(imageFileFormat(png),'png_pipe');
  assert.equal(imageFileFormat(Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(40)])),'jpeg_pipe');
  assert.equal(imageFileFormat(Buffer.concat([Buffer.from('RIFF0000WEBP'),Buffer.alloc(40)])),'webp_pipe');
  assert.throws(()=>imageFileFormat(Buffer.from('<svg>'+ 'x'.repeat(40))),/не является/);
  assert.throws(()=>imageFileFormat(Buffer.alloc(17*1024*1024)),/16 МиБ/);
});

test('image import preserves speech, clips, prompts and original bytes and guards owner/version/revision/pending', async () => fixture(async root => {
  const s=scope(); let job=await createJob(s,input,root); const cwd=jobDirectory(job.id,root), original=`${randomUUID()}.png`;
  await writeFile(join(cwd,original),png);
  job=await editJob(job.id,s,job.revision,draft=>{draft.audio={state:'ready',file:'voice.mp3'};draft.output='old.mp4';draft.shots[0].image={state:'ready',file:original,provider:'cloudflare-sdxl'};draft.shots[0].clip={file:'clip.mp4',source:'upload',duration:8,tail:'auto'};draft.shots[0].visual='clip';},root);
  const before=structuredClone(job), shot=job.shots[0].id;let decoded=0;
  const decode=async(bytes:Uint8Array,dir:string,file:string)=>{decoded++;await writeFile(join(dir,file),bytes);};
  for(const key of ['ownerId','projectId','versionId'] as const) await assert.rejects(importImage(job.id,{...s,[key]:randomUUID()},job.revision,shot,png,root,decode),/недоступно/);
  await assert.rejects(importImage(job.id,s,job.revision-1,shot,png,root,decode),/изменилось/); assert.equal(decoded,0);
  const imported=await importImage(job.id,s,job.revision,shot,png,root,decode);
  assert.equal(imported.shots[0].image.source,'upload'); assert.equal(imported.shots[0].image.provider,undefined); assert.equal(publicJob(imported).shots[0].image.source,'upload');
  assert.deepEqual(imported.audio,before.audio);assert.deepEqual(imported.shots[0].clip,before.shots[0].clip);assert.equal(imported.shots[0].visual,'clip');assert.equal(imported.shots[0].prompt,before.shots[0].prompt);
  assert.equal(imported.outputStale,true);assert.deepEqual(imported.attempts,[]);assert.deepEqual(await readFile(join(cwd,original)),png);
  await assert.rejects(importImage(job.id,s,imported.revision,shot,png,root,async()=>{throw Error('decode failed');}),/decode failed/);
  assert.deepEqual(await readJob(job.id,root),imported);
  job=await editJob(job.id,s,imported.revision,draft=>{draft.shots[0].image.state='pending';},root);
  await assert.rejects(importImage(job.id,s,job.revision,shot,png,root,decode),/текущей задачи/); assert.equal(decoded,1);
  job=await editJob(job.id,s,job.revision,draft=>{draft.status='queued';},root);
  await assert.rejects(importImage(job.id,s,job.revision,shot,png,root,decode),/завершения/);
}));

test('switching to FLUX preserves old files and requires budget; successful replacement records real provider', async () => fixture(async root => {
  const s=scope(); const job=await createJob(s,input,root);const shot=job.shots[0]; shot.image={state:'ready',file:'imported.png',source:'upload'};job.audio={state:'ready',file:'voice.mp3'};
  selectImageProvider(job,provider);assert.equal(shot.image.source,'upload');assert.equal(estimatedCost(job,'replace',shot.id),0.015);
  assert.throws(()=>queueOperation(job,{kind:'replace',shotId:shot.id,budgetUSD:0,reservedUSD:0},true),/предел/);
  queueOperation(job,{kind:'replace',shotId:shot.id,budgetUSD:0.02,reservedUSD:0},true);assert.equal(shot.image.source,'upload');let calls=0;
  const deps:ProductionServices={config:{enabled:true,elevenKey:'',bflKey:''},speech:async()=>{throw Error('no speech');},render:async()=>{throw Error('no render');},sleep:async()=>{},image:id=>({configured:true,checkConnection:async()=>{throw Error('no check');},poll:async()=>{throw Error('no poll');},submit:async()=>{
    calls++;assert.equal(id,provider);const saved=await readJob(job.id,root);assert.equal(saved.attempts.at(-1)?.model,model);assert.equal(saved.attempts.at(-1)?.estimatedUSD,0.015);return {pending:false,bytes:png,extension:'png'};
  }})};
  await processJob(job,root,deps);assert.equal(calls,1);assert.equal(job.shots[0].image.source,undefined);assert.equal(job.shots[0].image.provider,provider);assert.equal(job.audio.file,'voice.mp3');
}));
