import test from "node:test";
import assert from "node:assert/strict";
import {testScenes,validScenes} from "../src/lib/scenes";
import {addScene,moveScene,removeScene,sceneEditsPayload,type EditorScene} from "../src/lib/scene-editing";
test("segmentation preserves narration and respects scene limits",()=>{
 for(const content of ["Короткий сценарий.","я".repeat(20000),("слово ".repeat(3400)).slice(0,20000)]) {
  const scenes = testScenes(content,"ru","Кино");
  assert.ok(validScenes(scenes));
  assert.equal(scenes.map(scene=>scene.narration).join("").replace(/\s/g,""),content.replace(/\s/g,""));
  assert.ok(scenes.every(scene=>scene.visual_prompt.includes("ТЕСТОВЫЙ ШАБЛОН")));
 }
});
test("English scenes are marked and preserve original narration",()=>{
 const scenes=testScenes("A traveler arrives.","en","Documentary");
 assert.match(scenes[0].visual_prompt,/TEST TEMPLATE/);
 assert.equal(scenes[0].narration,"A traveler arrives.");
});
test("separate paragraphs become separate scenes",()=>{
 const scenes=testScenes("Открываем дверь.\n\nВходим в комнату.\n\nСмотрим в окно.","ru","Кино");
 assert.equal(scenes.length,3);
 assert.equal(scenes[1].narration,"Входим в комнату.");
});
test("rejects invalid scene sets before saving",()=>{
 const scene={description:"Кадр",visual_prompt:"Промпт",narration:"Текст"};
 for(const value of [null,[],[null],{},Array(13).fill(scene),[{...scene,narration:" "}],[{...scene,description:42}],[{...scene,visual_prompt:"я".repeat(2001)}]]) assert.equal(validScenes(value),false);
 assert.equal(validScenes(Array(12).fill(scene)),true);
});

const editable: EditorScene[] = ['yandex','test','manual'].map((source,index)=>({
 key:`key-${index}`,source:source as EditorScene['source'],description:`Frame ${index}`,visual_prompt:`Prompt ${index}`,narration:`Speech ${index}`,
}));
test("moving and deleting scenes keeps each source and text together without mutating saved input",()=>{
 const before=JSON.stringify(editable);
 const moved=moveScene(editable,'key-2',-1);
 assert.deepEqual(moved.map(scene=>scene.key),['key-0','key-2','key-1']);
 assert.equal(moved[1].source,'manual');
 assert.equal(moved[1].narration,'Speech 2');
 const removed=removeScene(moved,'key-0');
 assert.deepEqual(sceneEditsPayload(removed)?.map(scene=>scene.source),['manual','test']);
 assert.equal(JSON.stringify(editable),before);
 assert.equal(moveScene(editable,'key-0',-1),editable);
 assert.equal(moveScene(editable,'key-2',1),editable);
 assert.equal(moveScene(editable,'missing',1),editable);
});
test("new scenes are manual drafts, bounded at twelve and require all fields",()=>{
 let scenes=addScene([], 'new');
 assert.equal(scenes[0].source,'manual');
 assert.equal(sceneEditsPayload(scenes),null);
 assert.equal(addScene(scenes,'new'),scenes);
 for(let i=1;i<12;i++) scenes=addScene(scenes,`new-${i}`);
 assert.equal(scenes.length,12);
 assert.equal(addScene(scenes,'overflow'),scenes);
 assert.deepEqual(sceneEditsPayload(removeScene([editable[0]],editable[0].key)),[]);
 assert.equal(validScenes([]),false); // Empty model responses must still fail.
});
test("saving mixed sources whitelists fields and preserves order, rejecting invalid sets",()=>{
 const input=editable.map(scene=>({...scene,description:` ${scene.description} `,script_version_id:'forged',position:99}));
 const payload=sceneEditsPayload(input)!;
 assert.deepEqual(payload.map(scene=>scene.source),['yandex','test','manual']);
 assert.equal(payload[0].description,'Frame 0');
 assert.ok(!('key' in payload[0]) && !('script_version_id' in payload[0]) && !('position' in payload[0]));
 for(const value of [null,{},[null],[{...editable[0],source:'unknown'}],[{...editable[0],source:null}],[{...editable[0],source:undefined}],[{...editable[0],narration:' '}],[{...editable[0],narration:'x'.repeat(2001)}],Array(13).fill(editable[0])]) assert.equal(sceneEditsPayload(value),null);
});
