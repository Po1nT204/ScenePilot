import test from 'node:test';
import assert from 'node:assert/strict';
import {shotsPayload} from '../src/lib/shots';
import {stableSceneEditsPayload} from '../src/lib/scene-editing';
import {exportText,exportShots,type ExportDocument} from '../src/lib/export';
import {narrationTarget,narrationDeviation} from '../src/lib/narration';
import {scriptGenerationOptions} from '../src/lib/duration';
import {requestYandexScript} from '../src/lib/ai/yandex-client';
const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222';
const shot={narration_excerpt:'First sentence.',action:'Lights go out',visual_prompt:'City at sunset',duration_seconds:3,source:'manual' as const};
test('shot payload validates limits and strips client ownership and ordering',()=>{
 assert.deepEqual(shotsPayload([{...shot,id:a,scene_id:'foreign',script_version_id:'foreign',position:99,key:'local'}]),[{...shot,id:a}]);
 assert.deepEqual(shotsPayload([]),[]);
 for(const invalid of [null,{},Array(41).fill(shot),[{...shot,id:'wrong'}],[{...shot,id:a},{...shot,id:a.toUpperCase()}],...[0,61,1.5,NaN,'5',null].map(duration_seconds=>[{...shot,duration_seconds}]),[{...shot,source:'unknown'}],[{...shot,action:' '}],[{...shot,narration_excerpt:'x'.repeat(1001)}],[{...shot,visual_prompt:'x'.repeat(2001)}]]) assert.equal(shotsPayload(invalid),null);
 assert.equal(shotsPayload(Array(40).fill(shot))?.length,40);
});
test('stable scene payload keeps valid ids but rejects duplicate and invalid ids',()=>{
 const scene={id:a,description:' Episode ',visual_prompt:' Room ',narration:' Voice ',source:'manual',shot_count:4};
 assert.deepEqual(stableSceneEditsPayload([scene]),[{id:a,description:'Episode',visual_prompt:'Room',narration:'Voice',source:'manual'}]);
 assert.equal(stableSceneEditsPayload([scene,scene]),null);
 assert.equal(stableSceneEditsPayload([{...scene,id:'forged'}]),null);
});
const document:ExportDocument={versionId:'v1',versionNumber:1,createdAt:'now',content:'Saved script.',source:'manual',snapshot:{title:'Title',topic:'Topic',genre:'What if',style:'Calm',language:'en',target_duration_seconds:30,narration_pace:140},scenes:[{id:b,script_version_id:'v1',position:2,description:'Second',narration:'Second sentence.',visual_prompt:'Scene two',source:'test'},{id:a,script_version_id:'v1',position:1,description:'First',narration:'First sentence.',visual_prompt:'Scene one',source:'manual'}],shots:[{...shot,id:'shot2',scene_id:b,script_version_id:'v1',position:1,visual_prompt:'Second prompt'},{...shot,id:'shot1',scene_id:a,script_version_id:'v1',position:1,visual_prompt:'First prompt'}],shotPlans:[{scene_id:a,script_version_id:'v1',narration_snapshot:'First sentence.'}]};
test('shot exports use episode then shot order and preserve clean modes',()=>{
 assert.equal(exportText(document,'txt','shots'),'First prompt\n\n---\n\nSecond prompt');
 assert.equal(exportText(document,'txt','visuals'),'Scene one\n\n---\n\nScene two');
 assert.equal(exportText(document,'txt','narration'),'Saved script.');
 for(const format of ['txt','md'] as const) {
  const archive=exportText(document,format);assert.match(archive,/140 слов\/мин/);assert.match(archive,/Кадр 1.1/);assert.match(archive,/Lights go out/);assert.match(archive,/требует сверки/);assert.match(archive,/ID кадра: shot1/);
 }
 assert.equal(exportText({...document,shots:[],shotPlans:[]},'txt','shots'),'');
});
test('exports reject mixed versions, foreign scene ids, duplicate shots and plans',()=>{
 for(const changes of [{shots:[{...document.shots![0],script_version_id:'v2'}]},{shots:[{...document.shots![0],scene_id:'foreign'}]},{shots:[document.shots![0],document.shots![0]]},{shotPlans:[{scene_id:a,script_version_id:'v2',narration_snapshot:'text'}]}]) assert.throws(()=>exportShots({...document,...changes}));
});
test('word target and deviation follow chosen pace, not a fixed duration claim',()=>{
 assert.deepEqual(narrationTarget(30,140),{pace:140,words:70,minWords:63,maxWords:77});
 assert.equal(narrationTarget(600,160).words,1600);
 assert.equal(narrationTarget(600,140).maxWords,1540);
 assert.deepEqual(narrationDeviation('word '.repeat(84),70),{words:84,difference:14,percent:20});
 for(const pace of [79,221,140.5,NaN]) assert.throws(()=>narrationTarget(30,pace));
 assert.deepEqual(scriptGenerationOptions(301),{maxTokens:'6000',timeoutMs:90000});
 assert.equal(scriptGenerationOptions(301,'yandexgpt-5-lite'),null);
 assert.deepEqual(scriptGenerationOptions(300),{maxTokens:'2000',timeoutMs:45000});
});
test('script prompt gets pace and word range; invalid input and Lite long request never call transport',async()=>{
 const config={apiKey:'TEST',folderId:'test',model:'yandexgpt-5.1'};
 const brief={title:'Title',topic:'Topic',style:'Calm',genre:'Story',language:'en',target_duration_seconds:30,narration_pace:140};
 await requestYandexScript(config,brief,async(_url,init)=>{
  const body=JSON.parse(String(init?.body));const input=JSON.parse(body.messages[1].text);
  assert.equal(input.target_words,70);assert.equal(input.min_words,63);assert.equal(input.max_words,77);assert.equal(input.narration_pace,140);
  return Response.json({alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text:'A complete thought.'}}]});
 });
 for(const narration_pace of [79,221,NaN]) await assert.rejects(requestYandexScript(config,{...brief,narration_pace},async()=>assert.fail('Must not call transport')));
 await assert.rejects(requestYandexScript({...config,model:'yandexgpt-5-lite'},{...brief,target_duration_seconds:600},async()=>assert.fail('Must not call transport')));
 let calls=0;
 await assert.rejects(requestYandexScript(config,{...brief,target_duration_seconds:600},async()=>{calls++;return Response.json({alternatives:[{status:'ALTERNATIVE_STATUS_TRUNCATED_FINAL',message:{text:'Unfinished'}}]});}),/неполный/);
 assert.equal(calls,1);
});
