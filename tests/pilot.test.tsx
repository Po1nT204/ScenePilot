import assert from 'node:assert/strict';
import test from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {NarrationMeter} from '../src/components/narration-meter';
import {countNarrationWords,estimateNarration,formatDuration,compareNarration} from '../src/lib/narration';
import {supportsFullGeneration,validDuration} from '../src/lib/duration';
import {requestYandexScript,requestYandexScenes,requestYandexIdeas} from '../src/lib/ai/yandex-client';
import {testScenes,validScenes} from '../src/lib/scenes';
import {testIdeas,validateIdeaRequest} from '../src/lib/ideas';
import {exportText,type ExportDocument} from '../src/lib/export';

test('narration counts English and Russian words without counting punctuation',()=>{
 assert.equal(countNarrationWords('Hello, world!\nПривет, мир!'),4);
 assert.equal(countNarrationWords("Don't re-enter 2026. It’s fine."),5);
 assert.equal(countNarrationWords('  ... — 🚀 \n'),0);
 assert.equal(countNarrationWords('Что-то изменилось: 42 примера.'),4);
});
test('timing is explicitly based on pace and target, handles empty and invalid assumptions',()=>{
 const text='word '.repeat(1400);
 assert.deepEqual(estimateNarration(text,600,140),{words:1400,seconds:600,targetWords:1400,fit:'near'});
 assert.equal(estimateNarration(text,600,80).fit,'long');
 assert.equal(estimateNarration(text,600,220).fit,'short');
 assert.equal(estimateNarration('',600,140).fit,'empty');
 for(const pace of [0,79,221,140.5,NaN]) assert.throws(()=>estimateNarration(text,600,pace));
 assert.equal(formatDuration(0),'0:00');assert.equal(formatDuration(601),'10:01');
});
test('comparison tolerates whitespace only, detects missing, repeated and reordered narration',()=>{
 assert.equal(compareNarration('First.\nSecond.','First. Second.').matches,true);
 for(const changed of ['First.','Second. First.','First. First. Second.','first. Second.']) assert.equal(compareNarration('First. Second.',changed).matches,false);
});
test('long manual script splits without losing text and exports against its own saved duration',()=>{
 const content='A thought experiment needs clear assumptions. '.repeat(220);
 const scenes=testScenes(content,'en','Calm');
 assert.ok(validScenes(scenes));
 assert.equal(compareNarration(content,scenes.map(scene=>scene.narration).join('\n')).matches,true);
 const document:ExportDocument={versionId:'long-v1',versionNumber:1,createdAt:'date',content,source:'manual',snapshot:{title:'Long pilot',topic:'Hypothesis',genre:'Essay',style:'Calm',language:'en',target_duration_seconds:720},scenes:scenes.map((scene,i)=>({...scene,source:'test',position:i+1,script_version_id:'long-v1'}))};
 const output=exportText(document,'txt');
 assert.match(output,/720 сек/);assert.ok(output.includes(content));
});
test('long duration is valid for projects and ideas, full-text generation is blocked before transport',async()=>{
 const config={apiKey:'TEST',folderId:'test',model:'yandexgpt-5.1'};
 const brief={title:'Title',topic:'Topic',genre:'Essay',style:'Calm',language:'en',target_duration_seconds:600};
 for(const duration of [301,480,600,720,900]) {
  assert.equal(validDuration(duration),true);assert.ok(validateIdeaRequest('seed','en',duration));
  assert.equal(supportsFullGeneration(duration),false);
  await assert.rejects(requestYandexScript(config,{...brief,target_duration_seconds:duration},async()=>assert.fail('No paid request')),/до 5 минут/);
  await assert.rejects(requestYandexScenes(config,'Saved script',{...brief,target_duration_seconds:duration},async()=>assert.fail('No paid request')),/до 5 минут/);
 }
 assert.equal(validDuration(901),false);assert.equal(supportsFullGeneration(300),true);
 const request={seed:'Seed',duration:900,language:'en',channel:null};
 await requestYandexIdeas(config,request,async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  assert.equal(body.completionOptions.maxTokens,'2000');assert.equal(JSON.parse(body.messages[1].text).duration,900);
  return Response.json({alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text:JSON.stringify({ideas:testIdeas(request)})}}]});
 });
});
test('timing UI labels assumptions and does not submit pace as material settings',()=>{
 const html=renderToStaticMarkup(<NarrationMeter text="Hello world" targetSeconds={600} targetLabel="Цель сохранённой версии" sourceText="Hello" sceneCount={1} />);
 assert.match(html,/10:00/);assert.match(html,/отличается/);assert.match(html,/не сохраняется/);
 const input=html.match(/<input[^>]*>/)?.[0] ?? '';
 assert.ok(input);assert.ok(!input.includes('name='));assert.ok(!input.includes('required'));assert.match(input,/inputMode="numeric"/);
});
