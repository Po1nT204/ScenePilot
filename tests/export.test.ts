import test from "node:test";
import assert from "node:assert/strict";
import {exportText,exportFilename,type ExportDocument} from "../src/lib/export";
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
