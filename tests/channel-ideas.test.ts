import assert from "node:assert/strict";
import test from "node:test";
import { channelSnapshot, validateChannel, channelLimits, channelProjectDefaults } from "../src/lib/channel";
import { parseIdeas, testIdeas, validateIdeaRequest } from "../src/lib/ideas";
import { requestYandexIdeas, requestYandexScript, requestYandexScenes } from "../src/lib/ai/yandex-client";
import { exportText } from "../src/lib/export";

const profile = { name: "Everyday", audience: "Beginners", topics: "Inventions", tone: "Calm", format: "Explainer", avoid: "Dive into", language: "en" };
const request = { seed: "Containers", language: "en", duration: 60, channel: profile };
const config = { apiKey: "TEST_ONLY", folderId: "test", model: "yandexgpt-5.1" };
const brief = { title: "Title", topic: "Topic", genre: "Explainer", style: "Calm", language: "en", target_duration_seconds: 60 };
const complete = (text: string) => Response.json({ alternatives: [{ status: "ALTERNATIVE_STATUS_FINAL", message: { text } }], usage: { totalTokens: "123" } });

test("channel whitelist trims fields and excludes private DB metadata", () => {
  assert.deepEqual(channelSnapshot({ ...profile, name: " Everyday ", owner_id: "PRIVATE", updated_at: "PRIVATE", apiKey: "PRIVATE" }), profile);
  assert.equal(channelSnapshot(null), null);
  assert.equal(validateChannel({ ...profile, avoid: "" }).valid, true);
});

test("channel rejects missing, wrong-type, oversized fields and unsupported language", () => {
  for (const [key, limit] of Object.entries(channelLimits)) {
    assert.equal(validateChannel({ ...profile, [key]: "x".repeat(limit + 1) }).valid, false);
    assert.equal(validateChannel({ ...profile, [key]: 1 }).valid, false);
    if (key !== "avoid") assert.equal(validateChannel({ ...profile, [key]: " " }).valid, false);
  }
  assert.equal(validateChannel({ ...profile, language: "es" }).valid, false);
});

test("detailed channel requirements fit the profile without overflowing short project fields", () => {
  const detailed = { ...profile, tone: "t".repeat(1000), format: "f".repeat(1000), avoid: "a".repeat(1000) };
  assert.equal(validateChannel(detailed).valid, true);
  assert.deepEqual(channelProjectDefaults(detailed), { genre: "", style: "" });
  assert.deepEqual(channelSnapshot(detailed), detailed);
  assert.deepEqual(channelProjectDefaults(profile), { genre: "Explainer", style: "Calm" });
  assert.deepEqual(channelProjectDefaults(null), { genre: "", style: "" });
});

test("idea request rejects unbounded or invalid inputs before generation", () => {
  for (const args of [["", "en", 60], ["x".repeat(1001), "en", 60], ["a", "es", 60], ["a", "en", 301], ["a", "en", 1.5], ["a", "en", "60"]]) {
    assert.equal(validateIdeaRequest(...args as [unknown, unknown, unknown]), null);
  }
});

test("idea parser rejects malformed batches and discards model identifiers", () => {
  const ideas = testIdeas(request);
  assert.deepEqual(parseIdeas(JSON.stringify({ ideas: ideas.map(idea => ({ ...idea, owner_id: "forged", source: "yandex" })) })), ideas);
  for (const value of ["bad JSON", "null", "{}", JSON.stringify({ ideas: [] }), JSON.stringify({ ideas: ideas.slice(1) }), JSON.stringify({ ideas: [...ideas, ideas[0]] }), JSON.stringify({ ideas: ideas.map(idea => ({ ...idea, title: " " })) }), JSON.stringify({ ideas: ideas.map(idea => ({ ...idea, topic: "x".repeat(1201) })) })]) {
    assert.throws(() => parseIdeas(value));
  }
});

test("test ideas remain valid at maximum inputs and visibly identify templates", () => {
  const maxProfile = Object.fromEntries(Object.entries(channelLimits).map(([key, max]) => [key, "x".repeat(max)]));
  for (const language of ["ru", "en"]) {
    const ideas = testIdeas({ ...request, seed: "x".repeat(1000), language, channel: channelSnapshot({ ...maxProfile, language }) });
    assert.equal(parseIdeas(JSON.stringify({ ideas })).length, 3);
    assert.match(ideas[0].topic, language === "en" ? /TEST TEMPLATE/ : /ТЕСТОВЫЙ ШАБЛОН/);
  }
});

test("idea adapter uses one bounded private request and returns no auto-saved records", async () => {
  let calls = 0;
  const ideas = testIdeas(request);
  const result = await requestYandexIdeas(config, { ...request, channel: { ...profile, owner_id: "PRIVATE" } as typeof profile }, async (url, init) => {
    calls++;
    assert.equal(url, "https://ai.api.cloud.yandex.net/foundationModels/v1/completion");
    assert.equal(new Headers(init?.headers).get("x-data-logging-enabled"), "false");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.jsonObject, true);
    assert.equal(body.completionOptions.maxTokens, "2000");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    assert.ok(!body.messages[1].text.includes("PRIVATE"));
    assert.ok(!body.messages[1].text.includes("TEST_ONLY"));
    assert.equal(JSON.parse(body.messages[1].text).channel.avoid, profile.avoid);
    return complete(JSON.stringify({ ideas }));
  });
  assert.deepEqual(result, { ideas, tokens: 123 });
  assert.equal(calls, 1);
});

test("idea errors, truncation and malformed responses never retry or leak error bodies", async () => {
  for (const response of [new Response("SECRET", { status: 429 }), complete("{}"), Response.json({ alternatives: [{ status: "ALTERNATIVE_STATUS_TRUNCATED_FINAL", message: { text: "SECRET" } }] })]) {
    let calls = 0;
    await assert.rejects(requestYandexIdeas(config, request, async () => { calls++; return response; }), error => error instanceof Error && !error.message.includes("SECRET"));
    assert.equal(calls, 1);
  }
  await assert.rejects(requestYandexIdeas(config, { ...request, seed: "x".repeat(1001) }, async () => assert.fail("Must not call network")));
});

test("script and scene requests use the supplied frozen channel, not a later profile", async () => {
  const frozen = channelSnapshot(profile)!;
  const changedProfile = { ...profile, tone: "New tone" };
  assert.notEqual(frozen.tone, changedProfile.tone);
  await requestYandexScript(config, { ...brief, channel: frozen }, async (_url, init) => {
    assert.deepEqual(JSON.parse(JSON.parse(String(init?.body)).messages[1].text).channel, frozen);
    return complete("Narration");
  });
  await requestYandexScenes(config, "Saved narration", { ...brief, channel: frozen }, async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].text);
    assert.equal(input.channel.tone, "Calm");
    assert.equal(input.script, "Saved narration");
    return complete(JSON.stringify({ scenes: [{ description: "Frame", visual_prompt: "Prompt", narration: "Saved narration" }] }));
  });
});

test("export includes frozen channel and brief provenance and supports old snapshots", () => {
  const document = { versionId: "id", versionNumber: 1, createdAt: "date", content: "script", source: "manual", snapshot: { ...brief, channel: profile, brief_source: "test" }, scenes: [] };
  assert.match(exportText(document, "txt"), /Источник замысла: Тестовый шаблон/);
  assert.match(exportText(document, "md"), /Избегать: Dive into/);
  assert.doesNotThrow(() => exportText({ ...document, snapshot: brief }, "txt"));
});
