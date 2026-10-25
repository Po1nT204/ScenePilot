// Actual local decoding, using synthetic pixels only; no cloud or user materials.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJob, jobDirectory, readJob } from '../src/lib/production/store';
import { importImage } from '../src/lib/production/image-import';
import { runProgram } from '../src/lib/production/render';

test('real image importer decodes PNG/JPEG/WebP and rejects malformed or oversized rasters without changing the job', {timeout:120000}, async()=>{
  const root=await mkdtemp(join(tmpdir(),'sp-image-decode-'));
  try{
    const scope={ownerId:randomUUID(),projectId:randomUUID(),versionId:randomUUID()};let job=await createJob(scope,{title:'Image fixture',script:'A green landscape.',source:'test',voiceId:'fixture'},root);
    const cwd=jobDirectory(job.id,root), ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
    for(const [ext,codec] of [['png','png'],['jpg','mjpeg'],['webp','libwebp']]){
      await runProgram(ffmpeg,['-v','error','-f','lavfi','-i','color=c=green:s=640x360','-frames:v','1','-c:v',codec,'-threads','1','-update','1',`fixture.${ext}`],cwd,30000);
      job=await importImage(job.id,scope,job.revision,job.shots[0].id,await readFile(join(cwd,`fixture.${ext}`)),root);
      assert.equal(job.shots[0].image.source,'upload');
      await runProgram(ffmpeg,['-v','error','-xerror','-i',job.shots[0].image.file!,'-f','null','-'],cwd,30000);
    }
    const before=await readJob(job.id,root), file=job.shots[0].image.file!;
    const bad=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(64)]);
    await assert.rejects(importImage(job.id,scope,job.revision,job.shots[0].id,bad,root));assert.deepEqual(await readJob(job.id,root),before);
    await runProgram(ffmpeg,['-v','error','-f','lavfi','-i','color=c=green:s=4100x64','-frames:v','1','-threads','1','-update','1','wide.png'],cwd,30000);
    await assert.rejects(importImage(job.id,scope,job.revision,job.shots[0].id,await readFile(join(cwd,'wide.png')),root),/4096/);
    assert.equal((await readJob(job.id,root)).shots[0].image.file,file);
    assert.ok(!(await readdir(cwd)).some(name=>name.endsWith('.upload')||name.endsWith('.tmp')));
    await writeFile(join(cwd,'proof.txt'),'Only synthetic files were used.');
  }finally{assert.ok(root.startsWith(join(tmpdir(),'sp-image-decode-')));await rm(root,{recursive:true,force:true});}
});
