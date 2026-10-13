import assert from "node:assert/strict";
import test from "node:test";
import { generateTestScript, type ScriptBrief } from "../src/lib/scripts/test-generator";
import { validateScript } from "../src/lib/scripts/validation";
const brief: ScriptBrief = { title: "Космос", topic: "Как наблюдать Луну", genre: "Обучение", style: "Простой", language: "ru", target_duration_seconds: 60 };
test("test example is marked and reflects project settings", () => {
 const content = generateTestScript(brief);
 assert.match(content, /ТЕСТОВЫЙ ПРИМЕР/);
 for (const value of [brief.title, brief.topic, brief.genre, brief.style, "60 сек."]) assert.ok(content.includes(value));
 assert.equal(content, generateTestScript(brief));
 assert.equal(validateScript(content).error, undefined);
});
test("English project receives English outline without pretending to translate inputs", () => {
 const content = generateTestScript({ ...brief, language: "en" });
 assert.match(content, /TEST EXAMPLE/);
 assert.match(content, /OPENING/);
 assert.ok(content.includes(brief.topic));
 assert.match(content, /not translated/);
});
test("maximum project fields still produce a valid bounded script", () => {
 const content = generateTestScript({ ...brief, title: "я".repeat(120), topic: "я".repeat(4000), genre: "я".repeat(100), style: "я".repeat(100), target_duration_seconds: 300 });
 assert.equal(validateScript(content).error, undefined);
});
