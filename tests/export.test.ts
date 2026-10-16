import test from "node:test";
import assert from "node:assert/strict";
import {exportText,exportFilename,exportScenes,type ExportDocument} from "../src/lib/export";
const document:ExportDocument={
 versionId:"12345678-0000-4000-8000-000000000001",versionNumber:2,createdAt:"2026-10-13T10:00:00Z",
 content:"Первая строка.\n\nВторая строка с ё и 🚀.",source:"yandex",
 snapshot:{title:"Старое название",topic:"Луна",genre:"Обучение",style:"Простой",language:"ru",target_duration_seconds:60},
 scenes:[
  {script_version_id:"12345678-0000-4000-8000-000000000001",position:2,description:"Второй кадр",visual_prompt:"Свет из окна",narration:"Вторая реплика",source:"test"},
  {script_version_id:"12345678-0000-4000-8000-000000000001",position:1,description:"Первый кадр",visual_prompt:"Общий план",narration:"Первая реплика",source:"yandex"}
 ]
};
test("TXT contains saved snapshot, version, all fields and scenes in order",()=>{
 const text=exportText(document,"txt");
 for(const value of ["Старое название","Луна","Обучение","Простой","60 сек.","Версия: 2",document.versionId,document.content,"Источник сценария: YandexGPT","Источник: Тестовый шаблон","Свет из окна","Вторая реплика"]) assert.ok(text.includes(value),value);
 assert.ok(text.indexOf("Первый кадр")<text.indexOf("Второй кадр"));
 assert.equal(document.scenes[0].position,2);
 assert.equal(Buffer.from(text,"utf8").toString("utf8"),text);
});
test("Markdown preserves raw text with HTML and backticks in a longer fence",()=>{
 const content='<script>alert("x")</script>\n```\n# Не заголовок экспорта';
 const text=exportText({...document,content},"md");
 assert.ok(text.includes("````text\n"+content+"\n````"));
 assert.match(text, /^# ScenePilot — версия 2/);
 assert.ok(text.includes("#### Визуальный промпт"));
});
test("a version without scenes exports an explicit empty state",()=>{
 const text=exportText({...document,scenes:[],source:"unknown"},"txt");
 assert.ok(text.includes("Сохранённых сцен для этой версии нет."));
 assert.ok(text.includes("Не зафиксирован"));
});
test("cross-version and duplicate scene positions are rejected",()=>{
 assert.throws(()=>exportText({...document,scenes:[{...document.scenes[0],script_version_id:"foreign"}]},"txt"),/mismatch/);
 assert.throws(()=>exportText({...document,scenes:[document.scenes[0],document.scenes[0]]},"md"),/Duplicate/);
});
test("download name uses version and id, not unsafe project title",()=>{
 const changed={...document,snapshot:{...document.snapshot,title:'../CON:<bad> "name"'}};
 assert.equal(exportFilename(changed,"txt"),"scenepilot-v2-12345678.txt");
 assert.equal(exportFilename(changed,"md"),"scenepilot-v2-12345678.md");
});

test("export keeps manual and generated provenance in the saved scene order",()=>{
 const scenes=[{...document.scenes[0],source:'manual',position:1},{...document.scenes[1],position:2}];
 for(const format of ['txt','md'] as const) {
  const text=exportText({...document,scenes},format);
  assert.ok(text.includes('Источник: Ручной ввод'));
  assert.ok(text.includes('Источник: YandexGPT'));
  assert.ok(text.indexOf('Второй кадр')<text.indexOf('Первый кадр'));
 }
});

test("narration is exactly the stored script, with no trimming, wrapping or scene narration",()=>{
 const content='  What if?\r\n\r\nё 🚀 <b>text</b>\n```\nThe end.\n';
 for(const format of ['txt','md'] as const) {
  assert.equal(exportText({...document,content},format,'narration'),content);
  assert.equal(exportText({...document,content,scenes:[]},format,'narration'),content);
 }
});

test("visual export contains only verbatim prompts in saved order with separators",()=>{
 const text=exportText(document,'txt','visuals');
 assert.equal(text,'Общий план\n\n---\n\nСвет из окна');
 assert.deepEqual(exportScenes(document).map(scene=>scene.visual_prompt),['Общий план','Свет из окна']);
 assert.equal(document.scenes[0].position,2);
 const visual_prompt='  Close-up\n```\n<light> 🚀\n';
 assert.equal(exportText({...document,scenes:[{...document.scenes[0],visual_prompt}]},'txt','visuals'),visual_prompt);
});

test("no scenes means no visual package, while narration and archive remain available",()=>{
 const empty={...document,scenes:[]};
 assert.equal(exportText(empty,'txt','visuals'),'');
 assert.equal(exportText(empty,'txt','narration'),document.content);
 assert.match(exportText(empty,'md','archive'),/Сохранённых сцен для этой версии нет/);
});

test("every mode rejects mixed versions, duplicate positions and invalid publication",()=>{
 const publication:NonNullable<ExportDocument['publication']>={script_version_id:document.versionId,title:'Saved title',titles:[],description:'Saved description',source:'manual'};
 for(const mode of ['narration','visuals','archive'] as const) {
  for(const format of ['txt','md'] as const) {
   assert.throws(()=>exportText({...document,scenes:[{...document.scenes[0],script_version_id:'another-version'}]},format,mode),/Scene version mismatch/);
   assert.throws(()=>exportText({...document,scenes:[document.scenes[0],document.scenes[0]]},format,mode),/Duplicate scene position/);
   assert.throws(()=>exportText({...document,publication:{...publication,script_version_id:'another-version'}},format,mode),/Publication version mismatch/);
   assert.throws(()=>exportText({...document,publication:{...publication,title:''}},format,mode),/Invalid publication/);
  }
 }
});

test("explicit archive preserves legacy output, metadata and publication in both formats",()=>{
 const saved:ExportDocument={...document,publication:{script_version_id:document.versionId,title:'Saved title',titles:[],description:'Saved description',source:'manual'}};
 for(const format of ['txt','md'] as const) {
  const archive=exportText(saved,format,'archive');
  assert.equal(archive,exportText(saved,format));
  for(const value of [document.versionId,document.createdAt,document.snapshot.title,'Saved title','Saved description','Источник: Ручной ввод']) assert.ok(archive.includes(value));
  assert.equal(exportText(saved,format,'narration'),document.content);
  assert.equal(exportText(saved,format,'visuals'),'Общий план\n\n---\n\nСвет из окна');
 }
});

test("clean download names distinguish mode and selected version",()=>{
 assert.equal(exportFilename(document,'txt','narration'),'scenepilot-v2-12345678-narration.txt');
 assert.equal(exportFilename(document,'txt','visuals'),'scenepilot-v2-12345678-visuals.txt');
 const newer={...document,versionId:'87654321-0000-4000-8000-000000000002',versionNumber:3,content:'New script',scenes:[]};
 assert.equal(exportText(newer,'txt','narration'),'New script');
 assert.equal(exportText(document,'txt','narration'),document.content);
 assert.notEqual(exportFilename(newer,'txt','narration'),exportFilename(document,'txt','narration'));
});
