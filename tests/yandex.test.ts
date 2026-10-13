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

import {parseSceneContent,requestYandexScenes} from "../src/lib/ai/yandex-client";
test("scene JSON rejects missing, empty, malformed and oversized fields",()=>{
 for(const value of ["not json",'{"scenes":[]}',JSON.stringify({scenes:[{description:"x",visual_prompt:"x"}]}),JSON.stringify({scenes:[{description:"x",visual_prompt:"x",narration:"x".repeat(2001)}]}),JSON.stringify({scenes:Array(13).fill({description:"x",visual_prompt:"x",narration:"x"})})]) assert.throws(()=>parseSceneContent(value));
});
test("scene parser discards identifiers supplied by model and trims fields",()=>{
 assert.deepEqual(parseSceneContent(JSON.stringify({scenes:[{id:"forged",script_version_id:"foreign",description:" кадр ",visual_prompt:" свет ",narration:" речь "}]})),[{description:"кадр",visual_prompt:"свет",narration:"речь"}]);
});
test("scene request uses JSON mode, larger output cap and exact saved text",async()=>{
 let calls=0;
 const scenes=[{description:"Frame",visual_prompt:"A room",narration:"Saved narration."}];
 const result=await requestYandexScenes(config,"Saved narration.",brief,async(_url,init)=>{
  calls++;
  const body=JSON.parse(String(init?.body));
  assert.equal(body.jsonObject,true);assert.equal(body.completionOptions.maxTokens,"4000");
  const input=JSON.parse(body.messages[1].text);
  assert.equal(input.script,"Saved narration.");assert.equal(input.style,brief.style);
  return Response.json({alternatives:[{status:"ALTERNATIVE_STATUS_FINAL",message:{text:JSON.stringify({scenes})}}],usage:{totalTokens:"300"}});
 });
 assert.deepEqual(result,{scenes,tokens:300});assert.equal(calls,1);
});
test("scene generation rejects truncated JSON without retry",async()=>{
 let calls=0;
 await assert.rejects(requestYandexScenes(config,"Saved script",brief,async()=>{
  calls++;
  return Response.json({alternatives:[{status:"ALTERNATIVE_STATUS_TRUNCATED_FINAL",message:{text:'{"scenes":['}}]});
 }),/неполный/);
 assert.equal(calls,1);
});
test("oversized script is rejected before a paid scene request",async()=>{
 await assert.rejects(requestYandexScenes(config,"x".repeat(20001),brief,async()=>{assert.fail("Must not call network");}),/слишком длинный/);
});
