import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createJob, saveJob, readJob } from '../src/lib/production/store';

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
