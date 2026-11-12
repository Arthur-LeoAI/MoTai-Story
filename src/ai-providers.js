"use strict";

const PROVIDERS = Object.freeze({
  openai: Object.freeze({
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    endpoint: "responses",
    keyEnv: "OPENAI_API_KEY"
  }),
  deepseek: Object.freeze({
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    endpoint: "chat",
    keyEnv: "DEEPSEEK_API_KEY"
  })
});

const OPENAI_MODEL_PRIORITY = Object.freeze([
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.3",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5",
  "gpt-4.1",
  "gpt-4o"
]);

const DEEPSEEK_MODEL_PRIORITY = Object.freeze([
  "deepseek-flash",
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v4-flash",
  "deepseek-v3.2"
]);

const NON_WRITING_MODEL_PATTERN = /(?:embedding|moderation|image|audio|realtime|transcri|whisper|tts|dall-e|search|codex)/i;
const SMALL_MODEL_PATTERN = /(?:^|[-_.])(mini|nano|micro|lite)(?:$|[-_.])/i;
const SNAPSHOT_SUFFIX_PATTERN = /-\d{4}-\d{2}-\d{2}$/;

function normalizeProvider(value, fallback = "deepseek") {
  const id = String(value || "").trim().toLowerCase();
  if (Object.hasOwn(PROVIDERS, id)) {
    return id;
  }
  return Object.hasOwn(PROVIDERS, fallback) ? fallback : "deepseek";
}

function getProviderMetadata(provider) {
  return PROVIDERS[normalizeProvider(provider)];
}

function normalizeSecret(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve one provider's credential without modifying the supplied environment.
 *
 * Older builds stored a DeepSeek key in OPENAI_API_KEY. It is recognized only
 * when AI_PROVIDER explicitly says deepseek and no dedicated DeepSeek key is
 * present. This deliberately avoids copying or treating one key as valid for
 * both providers.
 */
function resolveProviderCredential(env = {}, provider = env.AI_PROVIDER) {
  const id = normalizeProvider(provider);
  const metadata = PROVIDERS[id];
  const activeProvider = String(env.AI_PROVIDER || "").trim().toLowerCase();
  const hasDedicatedDeepSeekKey = Boolean(normalizeSecret(env.DEEPSEEK_API_KEY));
  const openAiKeyIsLegacyDeepSeek = id === "openai"
    && activeProvider === "deepseek"
    && !hasDedicatedDeepSeekKey;
  const dedicatedKey = normalizeSecret(env[metadata.keyEnv]);
  if (dedicatedKey && !openAiKeyIsLegacyDeepSeek) {
    return {
      provider: id,
      apiKey: dedicatedKey,
      hasApiKey: true,
      keySource: metadata.keyEnv,
      needsMigration: false
    };
  }

  const legacyDeepSeekKey = id === "deepseek" && activeProvider === "deepseek"
    ? normalizeSecret(env.OPENAI_API_KEY)
    : "";
  if (legacyDeepSeekKey) {
    return {
      provider: id,
      apiKey: legacyDeepSeekKey,
      hasApiKey: true,
      keySource: "OPENAI_API_KEY",
      needsMigration: true
    };
  }

  return {
    provider: id,
    apiKey: "",
    hasApiKey: false,
    keySource: "",
    needsMigration: false
  };
}

function getProviderConfig(env = {}, provider = env.AI_PROVIDER) {
  const id = normalizeProvider(provider);
  const metadata = PROVIDERS[id];
  const credential = resolveProviderCredential(env, id);
  return {
    provider: id,
    label: metadata.label,
    baseUrl: metadata.baseUrl,
    endpoint: metadata.endpoint,
    apiKey: credential.apiKey,
    hasApiKey: credential.hasApiKey,
    keySource: credential.keySource,
    needsMigration: credential.needsMigration
  };
}

function publicProviderStatus(config, extra = {}) {
  const id = normalizeProvider(config?.provider);
  const metadata = PROVIDERS[id];
  return {
    provider: id,
    label: metadata.label,
    baseUrl: metadata.baseUrl,
    endpoint: metadata.endpoint,
    hasApiKey: Boolean(config?.hasApiKey),
    needsMigration: Boolean(config?.needsMigration),
    ...(typeof extra.model === "string" && extra.model ? { model: extra.model } : {}),
    ...(typeof extra.available === "boolean" ? { available: extra.available } : {}),
    ...(typeof extra.message === "string" && extra.message ? { message: extra.message } : {}),
    ...(typeof extra.code === "string" && extra.code ? { code: extra.code, params: extra.params || {} } : {}),
    ...(typeof extra.checkedAt === "string" && extra.checkedAt ? { checkedAt: extra.checkedAt } : {})
  };
}

function publicProviderStatuses(env = {}) {
  return Object.keys(PROVIDERS).map((provider) => {
    const config = getProviderConfig(env, provider);
    return publicProviderStatus(config);
  });
}

function extractModelIds(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : [];
  return [...new Set(items
    .map((item) => typeof item === "string" ? item : item?.id)
    .map((id) => String(id || "").trim())
    .filter(Boolean))];
}

function isSupportedWritingModel(provider, modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  if (!id || NON_WRITING_MODEL_PATTERN.test(id)) {
    return false;
  }
  if (provider === "openai") {
    return /^gpt-(?:4(?:o|\.1)?|5)(?:$|[-.])/.test(id) && !SMALL_MODEL_PATTERN.test(id);
  }
  if (provider === "deepseek") {
    return /^deepseek-(?:flash(?:$|-)|chat|reasoner|v\d)/.test(id) && !SMALL_MODEL_PATTERN.test(id);
  }
  return false;
}

function modelFamilyRank(modelId, priorities) {
  const id = modelId.toLowerCase();
  for (let index = 0; index < priorities.length; index += 1) {
    const family = priorities[index];
    if (id === family) {
      return index * 10;
    }
    if (id.startsWith(`${family}-`) && SNAPSHOT_SUFFIX_PATTERN.test(id)) {
      return index * 10 + 1;
    }
  }
  return priorities.length * 10;
}

function selectWritingModel(provider, modelIds, preferredModel = "") {
  const id = normalizeProvider(provider);
  const unique = [...new Set((Array.isArray(modelIds) ? modelIds : [])
    .map((model) => String(model || "").trim())
    .filter((model) => isSupportedWritingModel(id, model)))];
  const preferred = String(preferredModel || "").trim();
  if (preferred && unique.includes(preferred)) {
    return preferred;
  }

  const priorities = id === "openai" ? OPENAI_MODEL_PRIORITY : DEEPSEEK_MODEL_PRIORITY;
  return unique.sort((left, right) => {
    const rankDifference = modelFamilyRank(left, priorities) - modelFamilyRank(right, priorities);
    if (rankDifference) {
      return rankDifference;
    }
    const leftSnapshot = SNAPSHOT_SUFFIX_PATTERN.test(left) ? 1 : 0;
    const rightSnapshot = SNAPSHOT_SUFFIX_PATTERN.test(right) ? 1 : 0;
    if (leftSnapshot !== rightSnapshot) {
      return leftSnapshot - rightSnapshot;
    }
    return right.localeCompare(left, "en", { numeric: true });
  })[0] || "";
}

function buildModelListRequest(config) {
  const provider = normalizeProvider(config?.provider);
  const metadata = PROVIDERS[provider];
  const apiKey = normalizeSecret(config?.apiKey);
  if (!apiKey) {
    throw new Error(`${metadata.label} API Key is required`);
  }
  const baseUrl = String(config?.baseUrl || metadata.baseUrl).replace(/\/+$/, "");
  return {
    url: `${baseUrl}/models`,
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` }
  };
}

function normalizeMaxOutputTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 3200;
  }
  return Math.max(200, Math.min(8000, Math.round(number)));
}

function normalizeTemperature(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return Math.max(0, Math.min(2, number));
}

function applyDeepSeekThinking(body) {
  if (body.model !== "deepseek-flash") return body;
  const result = { ...body, thinking: { type: "enabled" }, reasoning_effort: "high" };
  // Thinking and final text share the output budget.
  result.max_tokens = Math.max(8192, Number(body.max_tokens) || 0);
  delete result.temperature;
  return result;
}

function buildTextRequest({
  provider,
  apiKey,
  model,
  systemPrompt = "",
  userPrompt = "",
  maxOutputTokens = 3200,
  temperature,
  stream = false,
  baseUrl
} = {}) {
  const id = normalizeProvider(provider);
  const metadata = PROVIDERS[id];
  const secret = normalizeSecret(apiKey);
  const selectedModel = String(model || "").trim();
  if (!secret) {
    throw new Error(`${metadata.label} API Key is required`);
  }
  if (!selectedModel || !isSupportedWritingModel(id, selectedModel)) {
    throw new Error(`No supported ${metadata.label} writing model was selected`);
  }

  const maxTokens = normalizeMaxOutputTokens(maxOutputTokens);
  const normalizedTemperature = normalizeTemperature(temperature);
  const headers = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json"
  };
  const apiBaseUrl = String(baseUrl || metadata.baseUrl).replace(/\/+$/, "");

  if (id === "openai") {
    const input = [];
    if (String(systemPrompt || "").trim()) {
      input.push({
        role: "system",
        content: [{ type: "input_text", text: String(systemPrompt) }]
      });
    }
    input.push({
      role: "user",
      content: [{ type: "input_text", text: String(userPrompt || "") }]
    });
    const body = {
      model: selectedModel,
      input,
      max_output_tokens: maxTokens,
      stream: Boolean(stream)
    };
    if (normalizedTemperature !== undefined) {
      body.temperature = normalizedTemperature;
    }
    return {
      provider: id,
      endpoint: metadata.endpoint,
      url: `${apiBaseUrl}/responses`,
      method: "POST",
      headers,
      body
    };
  }

  const messages = [];
  if (String(systemPrompt || "").trim()) {
    messages.push({ role: "system", content: String(systemPrompt) });
  }
  messages.push({ role: "user", content: String(userPrompt || "") });
  const body = {
    model: selectedModel,
    messages,
    max_tokens: maxTokens,
    stream: Boolean(stream)
  };
  if (normalizedTemperature !== undefined) {
    body.temperature = normalizedTemperature;
  }
  return {
    provider: id,
    endpoint: metadata.endpoint,
    url: `${apiBaseUrl}/chat/completions`,
    method: "POST",
    headers,
    body: applyDeepSeekThinking(body)
  };
}

function extractOpenAiText(payload) {
  if (typeof payload?.output_text === "string") {
    return payload.output_text.trim();
  }
  const chunks = [];
  for (const item of payload?.output || []) {
    if (typeof item?.text === "string") {
      chunks.push(item.text);
    }
    for (const part of item?.content || []) {
      if (typeof part === "string") {
        chunks.push(part);
      } else if (typeof part?.text === "string") {
        chunks.push(part.text);
      } else if (typeof part?.content === "string") {
        chunks.push(part.content);
      }
    }
  }
  return chunks.join("").trim();
}

function extractDeepSeekText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text || part?.content || "").join("").trim();
  }
  return "";
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function extractUsage(provider, payload) {
  const id = normalizeProvider(provider);
  const usage = payload?.usage || {};
  if (id === "openai") {
    const inputTokens = numberOrZero(usage.input_tokens);
    const outputTokens = numberOrZero(usage.output_tokens);
    return {
      inputTokens,
      outputTokens,
      totalTokens: numberOrZero(usage.total_tokens) || inputTokens + outputTokens,
      cachedInputTokens: numberOrZero(usage.input_tokens_details?.cached_tokens)
    };
  }
  const inputTokens = numberOrZero(usage.prompt_tokens);
  const outputTokens = numberOrZero(usage.completion_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: numberOrZero(usage.total_tokens) || inputTokens + outputTokens,
    cachedInputTokens: numberOrZero(usage.prompt_cache_hit_tokens)
  };
}

function parseTextResponse(provider, payload = {}) {
  const id = normalizeProvider(provider);
  return {
    provider: id,
    responseId: String(payload?.id || ""),
    model: String(payload?.model || ""),
    text: id === "openai" ? extractOpenAiText(payload) : extractDeepSeekText(payload),
    usage: extractUsage(id, payload)
  };
}

module.exports = {
  applyDeepSeekThinking,
  PROVIDERS,
  buildModelListRequest,
  buildTextRequest,
  extractModelIds,
  extractUsage,
  getProviderConfig,
  getProviderMetadata,
  isSupportedWritingModel,
  normalizeProvider,
  parseTextResponse,
  publicProviderStatus,
  publicProviderStatuses,
  resolveProviderCredential,
  selectWritingModel
};
