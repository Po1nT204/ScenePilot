import test from "node:test";
import assert from "node:assert/strict";
import { parseCompletion,requestYandexScript } from "../src/lib/ai/yandex-client";
const brief={title:"Title",topic:"Topic",genre:"Tutorial",style:"Plain",language:"en",target_duration_seconds:60};
const config={apiKey:"TEST_ONLY",folderId:"test-folder",model:"yandexgpt-5.1"};
const completion={alternatives:[{status:"ALTERNATIVE_STATUS_FINAL",message:{text:" A complete script. "}}],usage:{totalTokens:"120"}};
test("accepts complete response in both API envelopes",()=>{
 assert.deepEqual(parseCompletion(completion),{content:"A complete script.",tokens:120});
 assert.deepEqual(parseCompletion({result:completion}),parseCompletion(completion));
});
test("rejects truncated, filtered, malformed, empty and oversized responses",()=>{
 for(const payload of [null,{}, {alternatives:[null]}, ...["ALTERNATIVE_STATUS_TRUNCATED_FINAL","ALTERNATIVE_STATUS_CONTENT_FILTER","ALTERNATIVE_STATUS_PARTIAL"].map(status=>({alternatives:[{status,message:{text:"Incomplete"}}]})), ...[" ","x".repeat(20001)].map(text=>({alternatives:[{status:"ALTERNATIVE_STATUS_FINAL",message:{text}}]}))]) assert.throws(()=>parseCompletion(payload));
});
test("sends bounded request with privacy header to fixed endpoint",async()=>{
 let calls=0;
 const transport:typeof fetch=async(url,init)=>{
  calls++;assert.equal(url,"https://ai.api.cloud.yandex.net/foundationModels/v1/completion");
  const headers=new Headers(init?.headers);assert.equal(headers.get("x-data-logging-enabled"),"false");
  const body=JSON.parse(String(init?.body));assert.equal(body.completionOptions.maxTokens,"2000");
  assert.equal(body.modelUri,"gpt://test-folder/yandexgpt-5.1");assert.ok(init?.signal);
  assert.equal(body.messages[1].text.includes("TEST_ONLY"),false);
  return Response.json({result:completion});
 };
 assert.equal((await requestYandexScript(config,brief,transport)).tokens,120);assert.equal(calls,1);
});
test("HTTP and network errors never retry or expose response body",async()=>{
 for(const status of [401,403,429,500]) {
  let calls=0;
  const transport:typeof fetch=async()=>{calls++;return new Response("SECRET_DETAILS",{status});};
  await assert.rejects(requestYandexScript(config,brief,transport),error=>error instanceof Error && !error.message.includes("SECRET_DETAILS"));
  assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(requestYandexScript(config,brief,async()=>{calls++;throw new Error("SECRET_DETAILS");}),/автоматического повтора нет/);
 assert.equal(calls,1);
});
test("oversized prompt is rejected before any request",async()=>{
 await assert.rejects(requestYandexScript(config,{...brief,topic:"x".repeat(6001)},async()=>{assert.fail("Network must not be called");}),/Слишком длинные/);
});
