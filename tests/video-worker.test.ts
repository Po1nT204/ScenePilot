import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createJob, saveJob, readJob } from '../src/lib/production/store';
import { workerFailure } from '../src/lib/production/worker-diagnostics';

async function doctor(root: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/video-worker.ts', '--check'], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SCENEPILOT_MEDIA_DIR: root, VIDEO_GENERATION_ENABLED: 'false', ELEVENLABS_API_KEY: '', BFL_API_KEY: '' } });
  let output = '';
  child.stdout.on('data', value => { output += value.toString(); });
  child.stderr.on('data', value => { output += value.toString(); });
  const timer = setTimeout(() => child.kill(), 20000);
  try { const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); return {code, output}; }
  finally { clearTimeout(timer); }
}

test('doctor reclaims a dead lock without recovering or processing queued and running jobs', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'scenepilot-doctor-'));
  try {
    const files: [string,string][] = [];
    for (const status of ['queued','running'] as const) {
      const job = await createJob({ownerId:randomUUID(),projectId:randomUUID(),versionId:randomUUID()}, {title:'Check',script:'Test.',source:'test',voiceId:'fixture'},root);
      job.status=status; job.audio.state='requesting'; await saveJob(job,root);
      const file=join(root,job.id,'job.json'); files.push([file,await readFile(file,'utf8')]);
    }
    await writeFile(join(root,'worker.lock'),'2147483647');
    const result=await doctor(root); assert.equal(result.code,0); assert.match(result.output,/сборок прочитано: 2/);
    for (const [file,before] of files) assert.equal(await readFile(file,'utf8'),before);
    await assert.rejects(readFile(join(root,'worker.lock')), {code:'ENOENT'});
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('doctor leaves a live lock untouched and reports its cause', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'scenepilot-doctor-'));
  try {
    const lock=join(root,'worker.lock'); await writeFile(lock,String(process.pid));
    const result=await doctor(root); assert.equal(result.code,1); assert.match(result.output,/WORKER_LOCK_BUSY/);
    assert.equal(await readFile(lock,'utf8'),String(process.pid));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('worker diagnostics expose only known codes, never raw paths or provider secrets', () => {
  assert.match(workerFailure(Object.assign(new Error('SECRET'),{code:'EACCES'}),'folder'),/EACCES/);
  assert.match(workerFailure(new SyntaxError('SECRET'),'read'),/JSON/);
  for (const error of [new Error('SECRET'),{code:'SECRET'},null]) assert.doesNotMatch(workerFailure(error,'read'),/SECRET/);
});

test('worker starts with its real CLI and recovers interrupted tasks without generation', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'scenepilot-worker-'));
  const job = await createJob({ ownerId: randomUUID(), projectId: randomUUID(), versionId: randomUUID() }, { title: 'Recovery', script: 'Test.', source: 'test', voiceId: 'fixture' }, root);
  job.status = 'running'; job.audio.state = 'requesting'; await saveJob(job, root);
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/video-worker.ts'], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SCENEPILOT_MEDIA_DIR: root, VIDEO_GENERATION_ENABLED: 'false', ELEVENLABS_API_KEY: '', BFL_API_KEY: '' } });
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  let startup = '';
  child.stdout.on('data', value => { startup += value.toString(); });
  // Do not print stderr: Next may load local configuration, but test output needs no environment data.
  child.stderr.resume();
  try {
    let recovered = false;
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if ((await readJob(job.id, root)).status === 'failed') { recovered = true; break; }
      if (child.exitCode !== null) break;
    }
    assert.ok(startup.includes('Обработчик видео запущен'), 'CLI must start');
    assert.ok(recovered, 'interrupted job must be recovered');
    const saved = await readJob(job.id, root);
    assert.equal(saved.audio.state, 'unknown'); assert.equal(saved.attempts.length, 0);
  } finally { child.kill(); await exited; await rm(root, { recursive: true, force: true }); }
});
