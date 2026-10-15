import assert from 'node:assert/strict';
import test from 'node:test';
import {publicationPayload,parsePublication,testPublication,publicationLimits} from '../src/lib/publication';
import {requestYandexPublication} from '../src/lib/ai/yandex-client';
import {exportText,type ExportDocument} from '../src/lib/export';

const brief = {title:'What if cities had no cars?',topic:'Cities',genre:'Explainer',style:'Calm',language:'en',target_duration_seconds:60};
const material = {title:'A city without cars',titles:['A city without cars','How would travel change?','Streets for people'],description:'A hypothetical scenario from the script.',source:'manual' as const};
const config = {apiKey:'TEST_ONLY_SECRET',folderId:'test',model:'yandexgpt-5.1'};
const complete = (text:string) => Response.json({alternatives:[{status:'ALTERNATIVE_STATUS_FINAL',message:{text}}],usage:{totalTokens:'50'}});

test('manual publication accepts no alternatives, trims and excludes client ownership/version metadata',()=>{
 const result = publicationPayload({...material,title:' A city without cars ',titles:[],script_version_id:'foreign',owner_id:'private'});
 assert.deepEqual(result,{...material,titles:[]});
 assert.equal(publicationPayload({...material,title:'x'.repeat(100),description:'x'.repeat(5000)})?.description.length,5000);
});
test('publication rejects empty, oversized, malformed fields and invalid provenance',()=>{
 for(const value of [null,{},[],{...material,title:' '},{...material,title:'x'.repeat(101)},{...material,description:''},{...material,description:'x'.repeat(5001)},{...material,titles:null},{...material,titles:[1]},{...material,titles:[' ']},{...material,titles:['x'.repeat(101)]},{...material,titles:Array(4).fill('title')},{...material,source:'unknown'}]) assert.equal(publicationPayload(value),null);
});
test('model publication requires three distinct titles and forces Yandex provenance',()=>{
 assert.deepEqual(parsePublication(JSON.stringify({...material,script_version_id:'foreign',source:'manual'})),{...material,source:'yandex'});
 for(const value of ['bad','null','{}',JSON.stringify({...material,titles:[]}),JSON.stringify({...material,titles:['a','a','a']}),JSON.stringify({...material,titles:['a','b',' ']}),JSON.stringify({...material,description:42})]) assert.throws(()=>parsePublication(value));
});
test('test publication uses saved script excerpts, marks templates and respects both languages and limits',()=>{
 for(const language of ['ru','en']) {
  const result=testPublication('SAVED SCRIPT\n'+'x'.repeat(19980),{...brief,title:'x'.repeat(120),language});
  assert.ok(publicationPayload(result));
  assert.equal(result.titles.length,3);
  assert.ok(result.titles.every(title=>title.length<=publicationLimits.title));
  assert.match(result.description,/SAVED SCRIPT/);
  assert.match(result.description,language==='en' ? /TEST TEMPLATE/ : /ТЕСТОВЫЙ ШАБЛОН/);
  assert.equal(result.source,'test');
 }
});
test('publication adapter sends exactly the frozen script and whitelisted profile in one bounded request',async()=>{
 const channel={name:'Channel',audience:'Adults',topics:'Cities',tone:'Calm',format:'Essay',avoid:'Clickbait',language:'en',owner_id:'PRIVATE_ID',updated_at:'PRIVATE_TIME'};
 let calls=0;
 const result=await requestYandexPublication(config,'SAVED SCRIPT',{...brief,channel},async(url,init)=>{
  calls++;
  assert.equal(url,'https://ai.api.cloud.yandex.net/foundationModels/v1/completion');
  const body=JSON.parse(String(init?.body));
  const input=JSON.parse(body.messages[1].text);
  assert.equal(input.script,'SAVED SCRIPT');assert.equal(input.channel.tone,'Calm');
  assert.ok(!body.messages[1].text.includes('PRIVATE_'));assert.ok(!body.messages[1].text.includes('TEST_ONLY_SECRET'));
  assert.equal(body.completionOptions.maxTokens,'2000');assert.equal(body.jsonObject,true);
  assert.equal(new Headers(init?.headers).get('x-data-logging-enabled'),'false');assert.equal(init?.redirect,'error');assert.ok(init?.signal);
  return complete(JSON.stringify(material));
 });
 assert.equal(calls,1);assert.equal(result.material.source,'yandex');assert.equal(result.tokens,50);
});
test('publication failures never retry or fall back; invalid input never calls transport',async()=>{
 for(const response of [new Response('SECRET',{status:403}),complete('{}'),Response.json({alternatives:[{status:'ALTERNATIVE_STATUS_TRUNCATED_FINAL',message:{text:'SECRET'}}]})]) {
  let calls=0;
  await assert.rejects(requestYandexPublication(config,'Saved',brief,async()=>{calls++;return response;}),error=>error instanceof Error && !error.message.includes('SECRET'));
  assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(requestYandexPublication(config,'Saved',brief,async()=>{calls++;throw new Error('SECRET');}),error=>error instanceof Error && !error.message.includes('SECRET'));
 assert.equal(calls,1);
 for(const [content,settings] of [['',brief],['x'.repeat(20001),brief],['Saved',{...brief,language:'es'}],['"'.repeat(20000),brief]] as const) {
  await assert.rejects(requestYandexPublication(config,content,settings,async()=>assert.fail('No request allowed')));
 }
});
test('export includes only the matching saved publication, escapes Markdown and supports absent materials',()=>{
 const document:ExportDocument={versionId:'version-a',versionNumber:1,createdAt:'date',content:'Saved script',source:'manual',snapshot:brief,scenes:[],publication:{...material,script_version_id:'version-a',description:'<script>example</script>\n```'}};
 for(const format of ['txt','md'] as const) {
  const result=exportText(document,format);
  for(const value of [material.title,material.titles[1],document.publication!.description,'Источник: Ручной ввод']) assert.ok(result.includes(value));
  assert.match(exportText({...document,publication:null},format),/Материалы публикации для этой версии не сохранены/);
 }
 assert.ok(exportText(document,'md').includes('````text'));
 assert.throws(()=>exportText({...document,publication:{...document.publication!,script_version_id:'other'}},'txt'),/mismatch/);
 assert.throws(()=>exportText({...document,publication:{...document.publication!,description:''}},'txt'),/Invalid/);
});
