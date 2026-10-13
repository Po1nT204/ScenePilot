import test from "node:test";
import assert from "node:assert/strict";
import {testScenes,validScenes} from "../src/lib/scenes";
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
