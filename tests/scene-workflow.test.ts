import test from 'node:test';
import assert from 'node:assert/strict';
import { importSceneText } from '../src/lib/scene-import';
import { sameSceneText, saveScenesOnce, sceneSaveError } from '../src/lib/scene-save';
import { initialStoryboard } from '../src/lib/production/initial-storyboard';
import { requestYandexScript, requestYandexScenes, requestYandexIdeas } from '../src/lib/ai/yandex-client';
import { testIdeas } from '../src/lib/ideas';
const scene={description:'Train',visual_prompt:'Morning train, green coat',narration:'One thought. Another thought.',source:'manual' as const};
const id='00000000-0000-4000-8000-000000000001';
const complete=(text:string)=>Response.json({alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text}}]});
const config={apiKey:'TEST',folderId:'test',model:'yandexgpt-5.1'};
const brief={title:'Title',topic:'Topic',genre:'Essay',style:'Calm',language:'en',target_duration_seconds:300,narration_pace:150};

test('external scene import accepts Russian labels, multi-line narration and JSON; strips IDs and source',()=>{
  const text='СЦЕНА 01\nОписание: Train\nВизуальный промпт: Morning train, green coat\nОзвучка: One thought.\nAnother thought.\n\nСЦЕНА 02 (новая)\nОписание: Room\nВизуальный промпт: A room\nОзвучка: It’s quiet.';
  const parsed=importSceneText(text); assert.equal(parsed.length,2); assert.equal(parsed[0].narration,'One thought.\nAnother thought.'); assert.equal(parsed[1].source,'manual');
  const json=importSceneText(JSON.stringify({scenes:[{...scene,id,source:'yandex',owner_id:'foreign'}]}));
  assert.deepEqual(json,[scene]); assert.deepEqual(importSceneText('```json\n'+JSON.stringify(json)+'\n```'),json);
  for(const input of ['', '{}', 'SCENE 1\nDescription: Missing fields', JSON.stringify({scenes:Array(13).fill(scene)}), JSON.stringify([{...scene,narration:'x'.repeat(2001)}])]) assert.throws(()=>importSceneText(input));
});
test('lost write response reconciles via read without another write or losing IDs',async()=>{
  let writes=0,reads=0; const saved=[{...scene,id}];
  const result=await saveScenesOnce([scene],async()=>{writes++;throw Error('connection lost');},async()=>{reads++;return saved;});
  assert.equal(result.error,''); assert.deepEqual(result.scenes,saved); assert.equal(writes,1);assert.equal(reads,1);
  assert.equal(sameSceneText([{...scene,id}], [{...scene,id:'00000000-0000-4000-8000-000000000002'}]),false);
});
test('unconfirmed save keeps uncertainty; known errors are actionable and never expose server messages',async()=>{
  let writes=0;
  const result=await saveScenesOnce([scene],async()=>{writes++;return {data:null,error:{code:'57014',message:'secret'}};},async()=>[]);
  assert.match(result.error,/Запись могла пройти/);assert.match(result.error,/57014/);assert.doesNotMatch(result.error,/secret/);assert.equal(writes,1);
  const unreadable=await saveScenesOnce([scene],async()=>{throw Error();},async()=>{throw Error();});assert.match(unreadable.error,/Подтверждение/);
  assert.match(sceneSaveError({code:'23505'}),/порядка/);
  assert.match(sceneSaveError({code:'PGRST202'}),/миграцию/);
  const good=await saveScenesOnce([scene],async()=>({data:[{...scene,id}],error:null}),async()=>assert.fail('No read on success'));assert.equal(good.error,'');
});
test('initial video frame count scales with spoken words and preserves exact offsets',()=>{
  const minute=initialStoryboard('word '.repeat(150),150), five=initialStoryboard('word '.repeat(750),150);
  assert.equal(minute.shots.length,8); assert.equal(five.shots.length,38);
  for(const plan of [minute,five,initialStoryboard('Слова 🌅 у реки. '.repeat(20),140)]) {
    assert.equal(plan.shots.map(s=>s.text).join(' '),plan.text);
    for(const shot of plan.shots) assert.equal(plan.text.slice(shot.start,shot.end),shot.text);
  }
  assert.throws(()=>initialStoryboard('word',NaN));
});
test('scene-based video snapshots use the selected narration and retain visual prompts',()=>{
  const sources=[{...scene,id},{...scene,narration:'Completely different speech.',visual_prompt:'A quiet room'}];
  const plan=initialStoryboard('Old version text',150,sources);
  assert.equal(plan.text,'One thought. Another thought. Completely different speech.');
  assert.ok(plan.shots[0].prompt.startsWith(scene.visual_prompt));assert.equal(plan.shots[0].sourceSceneId,id);
  assert.ok(plan.shots.at(-1)!.prompt.startsWith('A quiet room'));
  assert.throws(()=>initialStoryboard('Old',150,[]));
});
test('twelve long scenes remain twelve authored frames without repeated prompts or lost speech',()=>{
  const sources=Array.from({length:12},(_,i)=>({...scene,narration:`Scene ${i}. `+'Words of the story. '.repeat(12),visual_prompt:`Distinct visual ${i}`}));
  const plan=initialStoryboard('Old version text',150,sources);
  assert.equal(plan.shots.length,12);
  assert.equal(plan.text, sources.map(s=>s.narration.trim()).join(' '));
  plan.shots.forEach((shot,i)=>{
    assert.equal(shot.prompt,sources[i].visual_prompt);
    assert.equal(shot.text,sources[i].narration.trim());
    assert.equal(plan.text.slice(shot.start,shot.end),shot.text);
  });
  assert.deepEqual(initialStoryboard('Old',80,sources),initialStoryboard('Old',220,sources));
});
test('five-minute script has larger cap and explicit length warning; revision sends current draft once',async()=>{
  let calls=0;
  const result=await requestYandexScript(config,brief,async(_url,init)=>{
    calls++;const body=JSON.parse(String(init?.body));const input=JSON.parse(body.messages[1].text);
    assert.equal(body.completionOptions.maxTokens,'4000'); assert.equal(input.target_words,750); assert.equal(input.draft,'Existing short draft.');
    return complete('Still too short.');
  },'Existing short draft.');
  assert.equal(calls,1);assert.match(result.warning!,/Объём не соблюдён/);assert.equal(result.content,'Still too short.');
});
test('scene generation rejects summarizing, reordering and missing narration, without paid retry',async()=>{
  for(const narration of ['One thought.', 'Another thought. One thought.', 'One changed thought. Another thought.']) {
    let calls=0;await assert.rejects(requestYandexScenes(config,scene.narration,brief,async()=>{calls++;return complete(JSON.stringify({scenes:[{...scene,narration}]}));}),/сократила или изменила/);assert.equal(calls,1);
  }
  const result=await requestYandexScenes(config,scene.narration,brief,async()=>complete(JSON.stringify({scenes:[{...scene,narration:'One thought.\nAnother thought.'}]})));
  assert.equal(result.scenes.length,1);
});
test('ideas use previous titles, varied temperature and flag repeated titles without retry',async()=>{
  const request={seed:'History',language:'en',duration:300,channel:null,previousTitles:['How it works: History']};let calls=0;
  const result=await requestYandexIdeas(config,request,async(_url,init)=>{
    calls++;const body=JSON.parse(String(init?.body));assert.equal(body.completionOptions.temperature,0.85);assert.deepEqual(JSON.parse(body.messages[1].text).avoid_titles,request.previousTitles);
    return complete(JSON.stringify({ideas:testIdeas(request)}));
  });
  assert.equal(calls,1);assert.match(result.warning!,/повторила/);
});
