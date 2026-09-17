"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROVIDERS,
  buildModelListRequest,
  buildTextRequest,
  extractModelIds,
  getProviderConfig,
  parseTextResponse,
  publicProviderStatuses,
  resolveProviderCredential,
  selectWritingModel
} = require("../src/ai-providers");

test("provider registry is intentionally limited to OpenAI and DeepSeek", () => {
  assert.deepEqual(Object.keys(PROVIDERS), ["openai", "deepseek"]);
  assert.equal(PROVIDERS.openai.endpoint, "responses");
  assert.equal(PROVIDERS.deepseek.endpoint, "chat");
  assert.equal(PROVIDERS.openai.keyEnv, "OPENAI_API_KEY");
  assert.equal(PROVIDERS.deepseek.keyEnv, "DEEPSEEK_API_KEY");
});

test("provider credentials stay isolated", () => {
  const env = {
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-secret",
    DEEPSEEK_API_KEY: "deepseek-secret"
  };
  assert.equal(resolveProviderCredential(env, "openai").apiKey, "openai-secret");
  assert.equal(resolveProviderCredential(env, "deepseek").apiKey, "deepseek-secret");
});

test("legacy DeepSeek key is recognized read-only only for an explicitly active DeepSeek provider", () => {
  const deepseekEnv = { AI_PROVIDER: "deepseek", OPENAI_API_KEY: "legacy-deepseek-secret" };
  const before = { ...deepseekEnv };
  const legacy = resolveProviderCredential(deepseekEnv, "deepseek");
  assert.equal(legacy.apiKey, "legacy-deepseek-secret");
  assert.equal(legacy.needsMigration, true);
  assert.deepEqual(deepseekEnv, before);
  assert.equal(resolveProviderCredential(deepseekEnv, "openai").hasApiKey, false);
  assert.equal(publicProviderStatuses(deepseekEnv).filter((item) => item.hasApiKey).length, 1);

  const openAiEnv = { AI_PROVIDER: "openai", OPENAI_API_KEY: "openai-secret" };
  assert.equal(resolveProviderCredential(openAiEnv, "deepseek").hasApiKey, false);
  const ambiguousEnv = { OPENAI_API_KEY: "openai-secret" };
  assert.equal(resolveProviderCredential(ambiguousEnv, "deepseek").hasApiKey, false);
});

test("public provider status exposes availability metadata but never secrets", () => {
  const env = {
    AI_PROVIDER: "deepseek",
    OPENAI_API_KEY: "openai-secret",
    DEEPSEEK_API_KEY: "deepseek-secret"
  };
  const statuses = publicProviderStatuses(env);
  assert.deepEqual(statuses.map((item) => item.provider), ["openai", "deepseek"]);
  assert.ok(statuses.every((item) => item.hasApiKey));
  assert.ok(statuses.every((item) => !Object.hasOwn(item, "apiKey")));
  const serialized = JSON.stringify(statuses);
  assert.doesNotMatch(serialized, /openai-secret|deepseek-secret/);
});

test("model IDs are normalized and long-form priorities choose a capable model", () => {
  const ids = extractModelIds({ data: [
    { id: "text-embedding-3-large" },
    { id: "gpt-4.1" },
    { id: "gpt-5.5-mini" },
    { id: "gpt-5.4-2026-08-01" },
    { id: "gpt-5.5" },
    { id: "gpt-5.5" }
  ] });
  assert.deepEqual(ids, [
    "text-embedding-3-large",
    "gpt-4.1",
    "gpt-5.5-mini",
    "gpt-5.4-2026-08-01",
    "gpt-5.5"
  ]);
  assert.equal(selectWritingModel("openai", ids), "gpt-5.5");
  assert.equal(selectWritingModel("openai", ids, "gpt-4.1"), "gpt-4.1");
  assert.equal(selectWritingModel("deepseek", ["deepseek-reasoner", "deepseek-chat"]), "deepseek-chat");
  assert.equal(selectWritingModel("openai", ["dall-e-3", "text-embedding-3-large"]), "");
});

test("model listing request uses only the selected provider credential", () => {
  const config = getProviderConfig({ AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "ds-key" });
  const request = buildModelListRequest(config);
  assert.equal(request.url, "https://api.deepseek.com/models");
  assert.equal(request.method, "GET");
  assert.equal(request.headers.Authorization, "Bearer ds-key");
});

test("OpenAI request uses Responses API shape", () => {
  const request = buildTextRequest({
    provider: "openai",
    apiKey: "oa-key",
    model: "gpt-5.5",
    systemPrompt: "system",
    userPrompt: "user",
    maxOutputTokens: 4000,
    temperature: 0.7
  });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.headers.Authorization, "Bearer oa-key");
  assert.equal(request.body.max_output_tokens, 4000);
  assert.equal(request.body.input[0].role, "system");
  assert.equal(request.body.input[1].content[0].text, "user");
  assert.equal(Object.hasOwn(request.body, "messages"), false);
});

test("DeepSeek request uses Chat Completions shape", () => {
  const request = buildTextRequest({
    provider: "deepseek",
    apiKey: "ds-key",
    model: "deepseek-chat",
    systemPrompt: "system",
    userPrompt: "user",
    maxOutputTokens: 2600,
    stream: true
  });
  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(request.headers.Authorization, "Bearer ds-key");
  assert.equal(request.body.max_tokens, 2600);
  assert.equal(request.body.stream, true);
  assert.deepEqual(request.body.messages, [
    { role: "system", content: "system" },
    { role: "user", content: "user" }
  ]);
  assert.equal(Object.hasOwn(request.body, "input"), false);
});

test("DeepSeek Flash is selectable and gets a thinking budget and high effort", () => {
  assert.equal(selectWritingModel("deepseek", ["deepseek-chat", "deepseek-flash"]), "deepseek-flash");
  const request = buildTextRequest({ provider: "deepseek", apiKey: "test-only", model: "deepseek-flash", userPrompt: "测试", maxOutputTokens: 32, temperature: 0.8 });
  assert.equal(request.body.model, "deepseek-flash");
  assert.deepEqual(request.body.thinking, { type: "enabled" });
  assert.equal(request.body.reasoning_effort, "high");
  assert.ok(request.body.max_tokens >= 8192);
  assert.equal(request.body.stream, false);
  assert.equal(Object.hasOwn(request.body, "temperature"), false);
});

test("provider responses expose text, actual model, response id, and normalized usage", () => {
  const openai = parseTextResponse("openai", {
    id: "resp_1",
    model: "gpt-5.5-2026-08-01",
    output: [{ content: [{ type: "output_text", text: "OpenAI 正文" }] }],
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      total_tokens: 200,
      input_tokens_details: { cached_tokens: 20 }
    }
  });
  assert.deepEqual(openai, {
    provider: "openai",
    responseId: "resp_1",
    model: "gpt-5.5-2026-08-01",
    text: "OpenAI 正文",
    usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200, cachedInputTokens: 20 }
  });

  const deepseek = parseTextResponse("deepseek", {
    id: "chat_1",
    model: "deepseek-chat",
    choices: [{ message: { content: "DeepSeek 正文" } }],
    usage: {
      prompt_tokens: 90,
      completion_tokens: 60,
      total_tokens: 150,
      prompt_cache_hit_tokens: 30
    }
  });
  assert.equal(deepseek.text, "DeepSeek 正文");
  assert.deepEqual(deepseek.usage, {
    inputTokens: 90,
    outputTokens: 60,
    totalTokens: 150,
    cachedInputTokens: 30
  });
});
