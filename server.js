const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const {
  clampNumber,
  createId,
  emptyStoryBible,
  findChapter,
  findWork,
  getBoldnessLabel,
  getWorkBoldness,
  getWorkTextBag,
  isStoryBibleEmpty,
  normalizeChapterPlanning,
  normalizeCoverStyle,
  normalizeStoryBible,
  normalizeText,
  nowIso,
  temperatureFromBoldness,
  workSummary
} = require("./src/domain");
const { createJsonStore } = require("./src/storage");
const { createTaskService, taskContext } = require("./src/tasks");
const { createBetaApi } = require("./src/beta-api");
const { normalizeTemporalFact, selectTemporalFacts, invalidateDependencies, classifyConflict, adjudicateConflict } = require("./src/temporal");
const { createWorkspaceService, upgradeWorkspace, normalizeScene, ensureVersion, transformScenes, deltaLength, makeHunks, mergeHunks, fail } = require("./src/workspace");
const {
  PROVIDERS,
  applyDeepSeekThinking,
  buildModelListRequest,
  buildTextRequest,
  extractModelIds,
  getProviderConfig,
  isSupportedWritingModel,
  normalizeProvider,
  parseTextResponse,
  publicProviderStatus,
  selectWritingModel
} = require("./src/ai-providers");
const {
  DATABASE_SCHEMA_VERSION,
  applyCanonProposal,
  canAcceptGeneration,
  hashChapterContent,
  normalizeCanonProposal,
  normalizeChapterMemory,
  normalizeConflict,
  normalizeGenerationRecord,
  selectContinuityContext,
  upgradeDatabase
} = require("./src/continuity");
const {
  ARTIFACT_DEFINITIONS,
  applyArtifactProposal,
  autoChatTitle,
  createArtifactProposal,
  createChatRecord,
  createMessage,
  ensureAiWorkspace,
  normalizeAiWorkspace,
  normalizeRichContent,
  plainTextToRichContent,
  revertArtifactProposal,
  richContentToMarkdown,
  selectChatContext
} = require("./src/studio");
const PACKAGE_VERSION = require("./package.json").version;

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(ROOT, "data", "db.json");
const DATA_DIR = path.dirname(DATA_FILE);
const COVER_DIR = path.join(DATA_DIR, "covers");
const WALLPAPER_DIR = path.join(DATA_DIR, "wallpapers");
const UI_PREFERENCES_FILE = path.join(DATA_DIR, "ui-preferences.json");
const COVER_URL_PREFIX = "/data/covers";
const WALLPAPER_URL_PREFIX = "/data/wallpapers";
const COVER_HISTORY_LIMIT = 16;
const DEFAULT_COVER_PATH = "/assets/writing-workspace.png";
const COVER_MAX_BYTES = 25 * 1024 * 1024;
const WALLPAPER_MAX_BYTES = 25 * 1024 * 1024;
const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
const BACKUP_MAX_COVER_BYTES = 40 * 1024 * 1024;
const BACKUP_FORMAT = "motai-backup";
const BACKUP_VERSION = 1;
const AUTOMATIC_BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;
const AUTOMATIC_BACKUP_RETENTION = 7;
const dataStore = createJsonStore(DATA_FILE);
const workspaceService = createWorkspaceService(dataStore, DATA_DIR);
const taskService = createTaskService(dataStore, async input => input.kind === "review" ? reviewChapterTask(input) : createConstrainedGeneration(input));
const betaApi = createBetaApi({ store: dataStore, service: workspaceService, tasks: taskService, readDb, readBody, sendJson, analyze: analyzeGeneratedText, canAccept: canAcceptGeneration, hash: hashChapterContent, normalizeMemory: normalizeChapterMemory, selectContext: selectContinuityContext });
let migrationTask;
const databaseBaselines = new WeakMap();
let automaticBackupTask = null;
const providerRuntimeStatus = new Map();
const PORT = Number(process.env.PORT || 5177);
const ENV_FILE = process.env.ENV_FILE
  ? path.resolve(process.env.ENV_FILE)
  : path.join(ROOT, ".env.local");

loadLocalEnv(ENV_FILE);
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_ENDPOINT = "responses";

const UI_PREFERENCE_THEMES = new Set(["light", "dark", "midnight", "paper"]);
const UI_PREFERENCE_EXPORT_FORMATS = new Set(["markdown", "txt", "html", "doc", "pdf"]);
const UI_PREFERENCE_INSPECTOR_TABS = new Set(["write", "bible", "characters", "world", "timeline", "cover", "work", "settings"]);
const UI_PREFERENCE_MAIN_VIEWS = new Set(["home", "create", ...UI_PREFERENCE_INSPECTOR_TABS]);
const UI_PREFERENCE_TOOLBAR_KEYS = ["ai", "bible", "work", "cover", "settings"];
const UI_WALLPAPER_THEMES = new Set(["light", "dark", "midnight", "paper"]);
const UI_BUILTIN_WALLPAPER_IDS = new Set(["dawn-desk", "ink-moon", "star-voyage", "amber-study"]);
const MAX_CUSTOM_WALLPAPERS = 12;

const AI_PROVIDER_PRESETS = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.5",
    endpoint: "responses"
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    endpoint: "chat"
  }
};

const AI_ENV_KEYS = [
  "AI_PROVIDER",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_ENDPOINT",
  "OPENAI_MAX_OUTPUT_TOKENS",
  "OPENAI_TIMEOUT_MS",
  "IMAGE_API_KEY",
  "IMAGE_BASE_URL",
  "IMAGE_MODEL",
  "IMAGE_TIMEOUT_MS",
  "OPENAI_IMAGE_MODEL",
  "AI_LOCAL_FALLBACK",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY"
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8"
};

async function readDb() {
  if (!migrationTask) migrationTask = (async () => {
    const existing = await dataStore.read();
    if (existing.schemaVersion < DATABASE_SCHEMA_VERSION && existing.works.length) {
      const dir = path.join(DATA_DIR, "backups"); await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, `schema-${existing.schemaVersion}-before-${Date.now()}.json`), JSON.stringify(existing), { flag: "wx" });
    }
    await dataStore.transact(async stored => {
      const upgraded = upgradeDatabase(stored);
      const covers = await migrateCoverStorage(upgraded.db);
      Object.assign(stored, covers.db);
    });
  })();
  await migrationTask;
  const raw = await dataStore.read();
  const upgraded = upgradeDatabase(raw);
  const covers = await migrateCoverStorage(upgraded.db);
  if (upgraded.changed || covers.changed) {
    await dataStore.write(covers.db);
    const fresh = await dataStore.read(); databaseBaselines.set(fresh, structuredClone(fresh)); return fresh;
  }
  databaseBaselines.set(covers.db, structuredClone(covers.db));
  return covers.db;
}

async function writeDb(db, { automaticBackup = true } = {}) {
  const upgraded = upgradeDatabase(db);
  const { db: migrated } = await migrateCoverStorage(upgraded.db);
  const baseline = databaseBaselines.get(db);
  let saved;
  if (baseline) {
    saved = await dataStore.transact(stored => {
      const changes = migrated.works.filter(w => JSON.stringify(w) !== JSON.stringify(baseline.works.find(x => x.id === w.id)));
      const removed = baseline.works.filter(w => !migrated.works.some(x => x.id === w.id));
      for (const w of [...changes, ...removed]) {
        if (JSON.stringify(stored.works.find(x => x.id === w.id)) !== JSON.stringify(baseline.works.find(x => x.id === w.id))) fail("作品已在其他窗口更新，未保存内容仍保留。", 409);
      }
      stored.works = stored.works.filter(w => !removed.some(x => x.id === w.id));
      for (const w of changes) { const at = stored.works.findIndex(x => x.id === w.id); if (at < 0) stored.works.unshift(w); else stored.works[at] = w; }
      return stored;
    });
  } else saved = await dataStore.write(migrated);
  db.storeRevision = saved.storeRevision;
  for (const work of db.works) {
    const persisted = saved.works.find(w => w.id === work.id);
    if (persisted) { work.structureRevision = persisted.structureRevision; work.canonRevision = persisted.canonRevision; work.volumes = persisted.volumes; work.deletedChapters = persisted.deletedChapters; work.writingPreferences = persisted.writingPreferences;
      for (const chapter of work.chapters || []) { const c = persisted.chapters.find(x => x.id === chapter.id); if (c) Object.assign(chapter, { revision: c.revision, revisions: c.revisions, scenes: c.scenes }); }
    }
  }
  databaseBaselines.set(db, structuredClone(saved));
  if (automaticBackup) {
    scheduleAutomaticBackup();
  }
}

function normalizeUiPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  const workspace = source.workspace && typeof source.workspace === "object" ? source.workspace : {};
  const toolbarPrefs = source.toolbarPrefs && typeof source.toolbarPrefs === "object" ? source.toolbarPrefs : {};
  const wallpaper = source.wallpaper && typeof source.wallpaper === "object" ? source.wallpaper : {};
  const text = (input) => normalizeText(input).slice(0, 160);
  const customWallpapers = Array.isArray(wallpaper.customWallpapers) ? wallpaper.customWallpapers : [];
  const safeCustomWallpapers = customWallpapers
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const id = text(item.id).replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
      const image = String(item.image || "").trim();
      const name = text(item.name) || "自定义壁纸";
      const theme = UI_WALLPAPER_THEMES.has(item.theme) ? item.theme : "";
      if (!id || !image.startsWith(`${WALLPAPER_URL_PREFIX}/`)) {
        return null;
      }
      return { id, name, image, theme, source: "custom" };
    })
    .filter(Boolean)
    .slice(0, MAX_CUSTOM_WALLPAPERS);
  const selectedId = text(wallpaper.selectedId) || "auto";

  return {
    version: 1,
    theme: UI_PREFERENCE_THEMES.has(source.theme) ? source.theme : "light",
    exportFormat: UI_PREFERENCE_EXPORT_FORMATS.has(source.exportFormat) ? source.exportFormat : "markdown",
    inspectorTab: UI_PREFERENCE_INSPECTOR_TABS.has(source.inspectorTab) ? source.inspectorTab : "write",
    toolbarPrefs: Object.fromEntries(UI_PREFERENCE_TOOLBAR_KEYS.map((key) => [key, toolbarPrefs[key] !== false])),
    wallpaper: {
      selectedId: selectedId === "off" || selectedId === "auto" || UI_BUILTIN_WALLPAPER_IDS.has(selectedId) || safeCustomWallpapers.some((item) => item.id === selectedId)
        ? selectedId
        : "auto",
      opacity: clampNumber(wallpaper.opacity, 8, 48, 22),
      customWallpapers: safeCustomWallpapers
    },
    workspace: {
      workId: text(workspace.workId),
      chapterId: text(workspace.chapterId),
      mainView: UI_PREFERENCE_MAIN_VIEWS.has(workspace.mainView) ? workspace.mainView : "home",
      previewMode: Boolean(workspace.previewMode)
    }
  };
}

async function readUiPreferences() {
  try {
    const raw = await fsp.readFile(UI_PREFERENCES_FILE, "utf8");
    return {
      exists: true,
      preferences: normalizeUiPreferences(JSON.parse(raw))
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { exists: false, preferences: normalizeUiPreferences({}) };
    }
    throw error;
  }
}

async function writeUiPreferences(value) {
  const preferences = normalizeUiPreferences(value);
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const temporaryFile = `${UI_PREFERENCES_FILE}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fsp.writeFile(temporaryFile, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
    await fsp.rename(temporaryFile, UI_PREFERENCES_FILE);
  } finally {
    await fsp.unlink(temporaryFile).catch(() => {});
  }

  return preferences;
}

function loadLocalEnv(envFile) {
  try {
    if (!fs.existsSync(envFile)) {
      return;
    }

    const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, equalsIndex).trim();
      let value = trimmed.slice(equalsIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn(`Could not load ${envFile}: ${error.message}`);
  }
}

function readLocalEnvMap() {
  const map = {};
  try {
    if (!fs.existsSync(ENV_FILE)) {
      return map;
    }

    const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex <= 0) {
        continue;
      }

      map[trimmed.slice(0, equalsIndex).trim()] = trimmed.slice(equalsIndex + 1).trim();
    }
  } catch (error) {
    console.warn(`Could not read ${ENV_FILE}: ${error.message}`);
  }

  return map;
}

async function writeLocalEnvMap(map) {
  await fsp.mkdir(path.dirname(ENV_FILE), { recursive: true });
  const known = new Set(AI_ENV_KEYS);
  const lines = ["# 本地 AI 配置文件。不要分享这个文件。"];

  for (const key of AI_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(map, key) && String(map[key] ?? "") !== "") {
      lines.push(`${key}=${map[key]}`);
    }
  }

  for (const [key, value] of Object.entries(map)) {
    if (!known.has(key) && String(value ?? "") !== "") {
      lines.push(`${key}=${value}`);
    }
  }

  await fsp.writeFile(ENV_FILE, `${lines.join("\n")}\n`, "utf8");

  for (const key of Object.keys(map)) {
    if (String(map[key] ?? "") === "") {
      delete process.env[key];
    } else {
      process.env[key] = String(map[key]);
    }
  }
}

function getProviderPreset(provider) {
  return AI_PROVIDER_PRESETS[normalizeProvider(provider)] || AI_PROVIDER_PRESETS.deepseek;
}

function getProviderOptions() {
  return Object.entries(AI_PROVIDER_PRESETS).filter(([value]) => value !== "custom").map(([value, preset]) => ({
    value,
    label: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    endpoint: preset.endpoint
  }));
}

function getAiConfig(includeKey = false, providerValue = process.env.AI_PROVIDER) {
  loadLocalEnv(ENV_FILE);
  const provider = normalizeProvider(providerValue, "deepseek");
  const preset = getProviderPreset(provider);
  const providerConfig = getProviderConfig(process.env, provider);
  const runtime = providerRuntimeStatus.get(provider) || {};
  const isActive = normalizeProvider(process.env.AI_PROVIDER, "deepseek") === provider;
  const baseUrl = String(isActive && process.env.OPENAI_BASE_URL || providerConfig.baseUrl || preset.baseUrl).replace(/\/+$/, "");
  const savedModel = provider === "deepseek" ? process.env.DEEPSEEK_MODEL : process.env.OPENAI_MODEL;
  const model = savedModel || runtime.model || (isActive ? process.env.AI_MODEL : "") || preset.model || DEFAULT_OPENAI_MODEL;
  const endpoint = providerConfig.endpoint || preset.endpoint || DEFAULT_OPENAI_ENDPOINT;
  const proxy = normalizeProxyUrl(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "");

  return {
    provider,
    providerLabel: preset.label,
    hasApiKey: providerConfig.hasApiKey,
    apiKey: includeKey ? providerConfig.apiKey : "",
    model,
    baseUrl,
    endpoint,
    maxOutputTokens: getOpenAiMaxOutputTokens(),
    timeoutMs: model === "deepseek-flash" ? Math.max(120000, getOpenAiTimeoutMs()) : getOpenAiTimeoutMs(),
    proxy,
    noProxy: process.env.NO_PROXY || "localhost,127.0.0.1",
    providers: getProviderOptions()
  };
}

function publicAiConfig() {
  const config = getAiConfig(false);
  return {
    ...config,
    modelDeprecated: false,
    image: publicImageConfig(),
    configured: isTestAiEnabled() || config.hasApiKey,
    statusProvider: isTestAiEnabled() ? "test" : config.provider,
    providerStatuses: Object.keys(PROVIDERS).map((provider) => {
      const providerConfig = getAiConfig(false, provider);
      const runtime = providerRuntimeStatus.get(provider) || {};
      return publicProviderStatus(providerConfig, runtime);
    })
  };
}

function getImageConfig(includeKey = false) {
  loadLocalEnv(ENV_FILE);
  const textConfig = getAiConfig(includeKey);
  const hasImageTransport = Boolean(process.env.IMAGE_API_KEY || process.env.IMAGE_BASE_URL);
  const canReuseTextTransport = !hasImageTransport
    && ["openai", "custom"].includes(textConfig.provider)
    && textConfig.hasApiKey
    && Boolean(textConfig.baseUrl);
  const apiKey = process.env.IMAGE_API_KEY || (canReuseTextTransport ? textConfig.apiKey : "");
  const baseUrl = String(process.env.IMAGE_BASE_URL || (canReuseTextTransport ? textConfig.baseUrl : DEFAULT_OPENAI_BASE_URL)).replace(/\/+$/, "");
  const model = process.env.IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
  const timeoutMs = Math.max(3000, Math.min(120000, Number(process.env.IMAGE_TIMEOUT_MS || 60000)));
  const hasApiKey = Boolean(process.env.IMAGE_API_KEY || (canReuseTextTransport && textConfig.hasApiKey));

  return {
    hasApiKey,
    apiKey: includeKey ? apiKey : "",
    baseUrl,
    model,
    timeoutMs,
    configured: Boolean(hasApiKey && baseUrl && model),
    reusesTextApi: canReuseTextTransport,
    providerLabel: canReuseTextTransport ? textConfig.providerLabel : "图片接口"
  };
}

function publicImageConfig() {
  const config = getImageConfig(false);
  return {
    hasApiKey: config.hasApiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    configured: config.configured,
    reusesTextApi: config.reusesTextApi,
    providerLabel: config.providerLabel
  };
}

function sanitizeUrl(value, fieldName) {
  const url = normalizeText(value);
  if (!url) {
    return "";
  }

  if (!/^https?:\/\//.test(url)) {
    const error = new Error(`${fieldName} 必须以 http:// 或 https:// 开头`);
    error.status = 400;
    throw error;
  }

  return url.replace(/\/+$/, "");
}

function normalizeProxyUrl(value) {
  const proxy = String(value || "").trim().replace(/\/+$/, "");
  if (!proxy) {
    return "";
  }

  try {
    const url = new URL(proxy);
    const host = url.hostname.toLowerCase();
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if ((host === "127.0.0.1" || host === "localhost") && port === PORT) {
      return "";
    }
  } catch {
    return proxy;
  }

  return proxy;
}

async function saveAiConfig(body) {
  const current = readLocalEnvMap();
  const provider = normalizeProvider(body.provider, "deepseek");
  const model = normalizeText(body.model);
  const providerConfig = getAiConfig(false, provider);
  if (!providerConfig.hasApiKey && !isTestAiEnabled()) {
    const error = new Error(`${providerConfig.providerLabel} 尚未由运行环境配置，不能选择该服务商的模型。`);
    error.status = 400;
    throw error;
  }
  if (!isSupportedWritingModel(provider, model)) {
    const error = new Error("请选择列表中的小说写作模型。");
    error.status = 400;
    throw error;
  }

  const next = {
    ...current,
    AI_PROVIDER: provider,
    ...(provider === "deepseek" ? { DEEPSEEK_MODEL: model } : { OPENAI_MODEL: model })
  };

  await writeLocalEnvMap(next);
  providerRuntimeStatus.delete(provider);
  return publicAiConfig();
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendDownload(res, file) {
  res.writeHead(200, {
    "Content-Type": file.mime,
    "Content-Length": file.buffer.length,
    "Content-Disposition": contentDisposition(file.fileName),
    "Cache-Control": "no-store"
  });
  res.end(file.buffer);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readBody(req, maxBytes = 5 * 1024 * 1024, limitError = "REQUEST_TOO_LARGE") {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error(limitError);
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function imageExtensionForMime(mime) {
  switch (String(mime || "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    default:
      return "";
  }
}

function imageMimeForExtension(extension) {
  switch (String(extension || "").toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "";
  }
}

function createCoverFileName(workId, extension) {
  const safeWorkId = String(workId || "work").replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "work";
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = createId("cover").slice(-8);
  return `${safeWorkId}-${stamp}-${suffix}${extension}`;
}

function createIllustrationFileName(workId, chapterId, extension) {
  const safeWorkId = String(workId || "work").replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "work";
  const safeChapterId = String(chapterId || "chapter").replace(/[^a-z0-9_-]/gi, "").slice(0, 64) || "chapter";
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = createId("illustration").slice(-8);
  return `illustration-${safeWorkId}-${safeChapterId}-${stamp}-${suffix}${extension}`;
}

function createWallpaperFileName(extension) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = createId("wallpaper").slice(-8);
  return `wallpaper-${stamp}-${suffix}${extension}`;
}

function parseImageDataUrl(value) {
  const raw = String(value || "").trim();
  if (!/^data:/i.test(raw)) {
    return null;
  }

  const match = raw.match(/^data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([\s\S]+)$/i);
  if (!match) {
    const error = new Error("Unsupported image data URL");
    error.status = 400;
    throw error;
  }

  const mime = match[1].toLowerCase();
  const extension = imageExtensionForMime(mime);
  if (!extension) {
    const error = new Error(`Unsupported cover image type: ${mime}`);
    error.status = 400;
    throw error;
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) {
    const error = new Error("Cover image data is empty");
    error.status = 400;
    throw error;
  }

  return { buffer, mime, extension };
}

function parseUploadedCover(value) {
  const image = parseImageDataUrl(value);
  if (!image) {
    const error = new Error("请上传有效的图片文件。");
    error.status = 400;
    throw error;
  }
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(image.mime)) {
    const error = new Error("仅支持 PNG、JPG 或 WebP 图片。");
    error.status = 400;
    throw error;
  }
  return image;
}

function parseUploadedIllustration(value) {
  const image = parseImageDataUrl(value);
  if (!image) {
    const error = new Error("请上传有效的图片文件。");
    error.status = 400;
    throw error;
  }
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(image.mime)) {
    const error = new Error("章节插图仅支持 PNG、JPG 或 WebP 图片。");
    error.status = 400;
    throw error;
  }
  return image;
}

function parseUploadedWallpaper(value) {
  const image = parseImageDataUrl(value);
  if (!image) {
    const error = new Error("请上传有效的 PNG、JPG 或 WebP 图片。");
    error.status = 400;
    throw error;
  }
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(image.mime)) {
    const error = new Error("壁纸仅支持 PNG、JPG 或 WebP 图片。");
    error.status = 400;
    throw error;
  }
  return image;
}

function getExtensionFromImageUrl(imageUrl) {
  try {
    const extension = path.extname(new URL(imageUrl).pathname).toLowerCase();
    return imageMimeForExtension(extension) ? extension : "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeFileName(value) {
  return String(value || "novel")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "novel";
}

function contentDisposition(fileName) {
  const fallback = safeFileName(fileName).replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function normalizeExportFormat(value) {
  const format = String(value || "markdown").trim().toLowerCase();
  const aliases = {
    md: "markdown",
    markdown: "markdown",
    txt: "txt",
    text: "txt",
    html: "html",
    htm: "html",
    doc: "doc",
    word: "doc",
    pdf: "pdf"
  };
  return aliases[format] || "";
}

function workExportTitle(work) {
  return normalizeText(work.title) || "未命名作品";
}

function workExportText(work) {
  const lines = [
    workExportTitle(work),
    "",
    normalizeText(work.premise),
    ""
  ];

  for (const chapter of work.chapters || []) {
    lines.push(chapter.title || "未命名章节", "", renderTextOnlyChapterContent(chapter.content), "");
  }

  return `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd()}\n`;
}

function buildMarkdownExport(work) {
  const lines = [
    `# ${workExportTitle(work)}`,
    "",
    work.premise || "",
    ""
  ];

  for (const chapter of work.chapters || []) {
    lines.push(`## ${chapter.title || "未命名章节"}`, "", chapter.content || "", "");
  }

  return lines.join("\n");
}

function buildHtmlExport(work, { word = false } = {}) {
  const title = escapeHtml(workExportTitle(work));
  const chapters = (work.chapters || []).map((chapter) => `
    <section class="chapter">
      <h2>${escapeHtml(chapter.title || "未命名章节")}</h2>
      ${renderExportChapterContent(chapter.content)}
    </section>
  `).join("\n");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { color: #1f2523; font-family: "Microsoft YaHei", "SimSun", serif; line-height: 1.85; margin: 42px auto; max-width: 760px; }
    h1 { font-size: 30px; margin: 0 0 8px; }
    h2 { border-bottom: 1px solid #d9e2dd; font-size: 22px; margin: 36px 0 18px; padding-bottom: 8px; }
    .premise { color: #66736e; margin-bottom: 34px; }
    p { margin: 0 0 16px; text-indent: 2em; white-space: pre-wrap; }
    .chapter-image { margin: 24px 0; text-align: center; }
    .chapter-image img { display: block; height: auto; margin: 0 auto; max-width: 100%; }
    .chapter-image figcaption { color: #66736e; font-size: 13px; margin-top: 8px; }
  </style>
  ${word ? "<!-- saved from url=(0014)about:internet -->" : ""}
</head>
<body>
  <h1>${title}</h1>
  <p class="premise">${escapeHtml(work.premise || "")}</p>
  ${chapters}
</body>
</html>`;
}

function extractLocalIllustrationUrl(value) {
  const source = String(value || "").trim();
  const pattern = /^\/data\/covers\/(illustration-[a-z0-9_-]+\.(?:png|jpe?g|webp))$/i;
  const match = source.match(pattern);
  return match ? `${COVER_URL_PREFIX}/${match[1]}` : "";
}

function renderExportChapterContent(content) {
  return String(content || "")
    .split(/\n{2,}|\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const imageMatch = paragraph.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/u);
      const imagePath = imageMatch ? extractLocalIllustrationUrl(imageMatch[2]) : "";
      if (imagePath) {
        return `<figure class="chapter-image"><img src="${escapeHtml(imagePath)}" alt="${escapeHtml(imageMatch[1] || "章节插图")}"><figcaption>${escapeHtml(imageMatch[1] || "章节插图")}</figcaption></figure>`;
      }
      return `<p>${escapeHtml(paragraph).replace(/\r?\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

function renderTextOnlyChapterContent(content) {
  return String(content || "").replace(/!\[([^\]]*)\]\(\/data\/covers\/illustration-[a-z0-9_-]+\.(?:png|jpe?g|webp)\)/gi, (_match, caption) => {
    return `【章节插图：${normalizeText(caption) || "未命名插图"}】`;
  }).trim();
}

function wrapPdfLine(text, maxChars = 34) {
  const value = String(text || "");
  const lines = [];
  let current = "";
  let currentWidth = 0;

  for (const char of value) {
    const width = /[\x00-\x7F]/.test(char) ? 0.55 : 1;
    if (current && currentWidth + width > maxChars) {
      lines.push(current);
      current = char;
      currentWidth = width;
    } else {
      current += char;
      currentWidth += width;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function pdfHexString(text) {
  const source = Buffer.from(String(text || ""), "utf16le");
  const be = Buffer.alloc(source.length);
  for (let index = 0; index < source.length; index += 2) {
    be[index] = source[index + 1];
    be[index + 1] = source[index];
  }
  return `<${be.toString("hex").toUpperCase()}>`;
}

function pdfEscapeAscii(text) {
  return String(text || "").replace(/[\\()]/g, "\\$&");
}

function buildPdfExport(work) {
  const rawLines = workExportText(work).split(/\r?\n/u);
  const lines = [];

  for (const line of rawLines) {
    if (!line.trim()) {
      lines.push("");
      continue;
    }
    lines.push(...wrapPdfLine(line, 34));
  }

  const pageLines = [];
  const linesPerPage = 34;
  for (let index = 0; index < lines.length; index += linesPerPage) {
    pageLines.push(lines.slice(index, index + linesPerPage));
  }

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>");
  addObject("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 >>");
  const pageIds = [];

  for (const page of pageLines.length ? pageLines : [[""]]) {
    const commands = ["BT", "/F1 14 Tf", "18 TL", "72 770 Td"];
    page.forEach((line) => {
      commands.push(`${pdfHexString(line)} Tj`, "T*");
    });
    commands.push("ET");
    const stream = commands.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const chunks = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"];
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(chunks.join("")));
    chunks.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let index = 1; index <= objects.length; index += 1) {
    chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info << /Title (${pdfEscapeAscii(workExportTitle(work))}) >> >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(chunks.join(""), "binary");
}

function buildWorkExportFile(work, formatValue) {
  const format = normalizeExportFormat(formatValue);
  if (!format) {
    return null;
  }

  const title = safeFileName(workExportTitle(work));
  const formats = {
    markdown: {
      extension: "md",
      mime: "text/markdown; charset=utf-8",
      buffer: Buffer.from(buildMarkdownExport(work), "utf8")
    },
    txt: {
      extension: "txt",
      mime: "text/plain; charset=utf-8",
      buffer: Buffer.from(workExportText(work), "utf8")
    },
    html: {
      extension: "html",
      mime: "text/html; charset=utf-8",
      buffer: Buffer.from(buildHtmlExport(work), "utf8")
    },
    doc: {
      extension: "doc",
      mime: "application/msword; charset=utf-8",
      buffer: Buffer.from(buildHtmlExport(work, { word: true }), "utf8")
    },
    pdf: {
      extension: "pdf",
      mime: "application/pdf",
      buffer: buildPdfExport(work)
    }
  };
  const file = formats[format];
  return {
    ...file,
    fileName: `${title}.${file.extension}`
  };
}

function backupTimestamp(value = new Date()) {
  return value.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function localCoverFileName(coverPath) {
  const value = String(coverPath || "").trim();
  if (!value.startsWith(`${COVER_URL_PREFIX}/`)) {
    return "";
  }

  let fileName = "";
  try {
    fileName = decodeURIComponent(value.slice(`${COVER_URL_PREFIX}/`.length));
  } catch {
    return "";
  }
  if (!fileName || path.basename(fileName) !== fileName || !imageMimeForExtension(path.extname(fileName))) {
    return "";
  }

  return fileName;
}

function normalizeCoverHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const cover = String(item.cover || "").trim();
      const id = String(item.id || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 80);
      if (!id || !localCoverFileName(cover) || seen.has(cover)) {
        return null;
      }
      seen.add(cover);
      return {
        id,
        cover,
        source: item.source === "upload" ? "upload" : item.source === "legacy" ? "legacy" : item.source === "layout" ? "layout" : "ai",
        prompt: normalizeText(item.prompt).slice(0, 360),
        createdAt: normalizeText(item.createdAt) || nowIso()
      };
    })
    .filter(Boolean)
    .slice(0, COVER_HISTORY_LIMIT);
}

function ensureCoverHistory(work) {
  const history = normalizeCoverHistory(work?.coverHistory);
  const currentCover = String(work?.cover || "").trim();
  if (localCoverFileName(currentCover) && !history.some((item) => item.cover === currentCover)) {
    history.unshift({
      id: createId("cover"),
      cover: currentCover,
      source: "legacy",
      prompt: "原有封面",
      createdAt: normalizeText(work?.updatedAt) || nowIso()
    });
  }
  work.coverHistory = history.slice(0, COVER_HISTORY_LIMIT);
  return work.coverHistory;
}

function recordCoverHistory(work, cover, { source = "ai", prompt = "" } = {}) {
  const entry = {
    id: createId("cover"),
    cover,
    source: source === "upload" ? "upload" : source === "layout" ? "layout" : "ai",
    prompt: normalizeText(prompt).slice(0, 360),
    createdAt: nowIso()
  };
  const history = normalizeCoverHistory(work?.coverHistory)
    .filter((item) => item.cover !== cover);
  work.cover = cover;
  work.coverHistory = [entry, ...history].slice(0, COVER_HISTORY_LIMIT);
  return entry;
}

function validateBackupCoverName(value) {
  const fileName = String(value || "").trim();
  if (!fileName || fileName.length > 180 || path.basename(fileName) !== fileName) {
    return "";
  }

  return imageMimeForExtension(path.extname(fileName)) ? fileName : "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function buildBackupPayload() {
  const db = await readDb();
  const history = {};
  for (const work of db.works) for (const chapter of [...work.chapters, ...(work.deletedChapters || [])]) {
    for (const revision of chapter.revisions || []) {
      history[revision.id] = { workId: work.id, chapter: await workspaceService.readSnapshot(work, chapter, revision.id) };
    }
  }
  const covers = {};
  let totalCoverBytes = 0;

  for (const work of db.works || []) {
    const fileNames = new Set([localCoverFileName(work?.cover)]);
    for (const item of normalizeCoverHistory(work?.coverHistory)) {
      fileNames.add(localCoverFileName(item.cover));
    }
    for (const chapter of work?.chapters || []) {
      const matcher = /!\[[^\]]*\]\((\/data\/covers\/illustration-[^)\s]+)\)/giu;
      for (const match of String(chapter?.content || "").matchAll(matcher)) {
        fileNames.add(localCoverFileName(match[1]));
      }
    }

    for (const fileName of fileNames) {
      if (!fileName || covers[fileName]) {
        continue;
      }

      const filePath = path.join(COVER_DIR, fileName);
      let buffer;
      try {
        buffer = await fsp.readFile(filePath);
      } catch (error) {
        if (error.code === "ENOENT") {
          continue;
        }
        throw error;
      }

      if (!buffer.length || buffer.length > COVER_MAX_BYTES) {
        const error = new Error(`本地图片无法备份：${fileName}`);
        error.status = 422;
        throw error;
      }

      totalCoverBytes += buffer.length;
      if (totalCoverBytes > BACKUP_MAX_COVER_BYTES) {
        const error = new Error("封面与章节插图总大小超过 40MB，无法创建单文件备份。请先移除部分过大的图片。");
        error.status = 413;
        throw error;
      }

      covers[fileName] = {
        mime: imageMimeForExtension(path.extname(fileName)),
        data: buffer.toString("base64")
      };
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: nowIso(),
    appVersion: PACKAGE_VERSION,
    database: cloneJson(db),
    covers,
    history
  };
}

function normalizeBackupPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("备份文件格式不正确。");
    error.status = 400;
    throw error;
  }

  if (value.format !== BACKUP_FORMAT || Number(value.version) !== BACKUP_VERSION) {
    const error = new Error("不是可恢复的墨台备份文件，或备份版本暂不受支持。");
    error.status = 400;
    throw error;
  }

  if (!value.database || typeof value.database !== "object" || !Array.isArray(value.database.works)) {
    const error = new Error("备份文件缺少作品库数据。");
    error.status = 400;
    throw error;
  }

  const covers = {};
  let totalCoverBytes = 0;
  for (const [name, item] of Object.entries(value.covers || {})) {
    const fileName = validateBackupCoverName(name);
    const expectedMime = imageMimeForExtension(path.extname(fileName));
    if (!fileName || !item || typeof item !== "object" || item.mime !== expectedMime || typeof item.data !== "string") {
      const error = new Error("备份中的封面数据不合法。");
      error.status = 400;
      throw error;
    }

    const buffer = Buffer.from(item.data, "base64");
    if (!buffer.length || buffer.length > COVER_MAX_BYTES) {
      const error = new Error("备份中的封面大小不合法。");
      error.status = 400;
      throw error;
    }

    totalCoverBytes += buffer.length;
    if (totalCoverBytes > BACKUP_MAX_COVER_BYTES) {
      const error = new Error("备份中的封面总大小超过恢复上限 40MB。");
      error.status = 413;
      throw error;
    }
    covers[fileName] = buffer;
  }

  return {
    database: upgradeDatabase(cloneJson(value.database)).db,
    covers
  };
}

async function createSafetyBackup(reason) {
  const payload = await buildBackupPayload();
  const backupDir = path.join(DATA_DIR, "backups");
  await fsp.mkdir(backupDir, { recursive: true });
  const filePath = path.join(backupDir, `墨台-${reason}-${backupTimestamp()}.motai-backup.json`);
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

async function listAutomaticBackups() {
  const backupDir = path.join(DATA_DIR, "backups");
  let entries = [];
  try {
    entries = await fsp.readdir(backupDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const backups = await Promise.all(entries
    .filter((entry) => entry.isFile() && /^墨台-自动-\d{14}\.motai-backup\.json$/u.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(backupDir, entry.name);
      const stats = await fsp.stat(filePath);
      return { name: entry.name, filePath, createdAt: stats.mtime.toISOString(), modifiedAt: stats.mtimeMs };
    }));

  return backups.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

async function getAutomaticBackupStatus() {
  const backups = await listAutomaticBackups();
  const latest = backups[0];
  return {
    intervalHours: AUTOMATIC_BACKUP_INTERVAL_MS / (60 * 60 * 1000),
    retention: AUTOMATIC_BACKUP_RETENTION,
    count: backups.length,
    lastBackup: latest ? { name: latest.name, createdAt: latest.createdAt } : null
  };
}

function scheduleAutomaticBackup() {
  if (automaticBackupTask) {
    return;
  }

  automaticBackupTask = (async () => {
    const backups = await listAutomaticBackups();
    const latest = backups[0];
    if (latest && Date.now() - latest.modifiedAt < AUTOMATIC_BACKUP_INTERVAL_MS) {
      return;
    }

    await createSafetyBackup("自动");
    const retained = await listAutomaticBackups();
    await Promise.all(retained.slice(AUTOMATIC_BACKUP_RETENTION).map((backup) => fsp.unlink(backup.filePath).catch(() => {})));
  })().catch((error) => {
    console.warn(`自动备份失败：${error.message}`);
  }).finally(() => {
    automaticBackupTask = null;
  });
}

async function restoreBackupPayload(value) {
  const backup = normalizeBackupPayload(value);
  const history = value.history || {};
  for (const work of backup.database.works) for (const chapter of [...work.chapters, ...(work.deletedChapters || [])]) {
    for (const revision of chapter.revisions || []) {
      const item = history[revision.id];
      if (!/^revision_[a-zA-Z0-9]+$/.test(revision.id) || !item || item.workId !== work.id || item.chapter?.id !== chapter.id) fail("备份中的章节历史引用无效。", 400);
    }
  }
  const restoreBase = (await readDb()).storeRevision;
  const previousBackup = await createSafetyBackup("恢复前");
  await fsp.mkdir(workspaceService.historyDir, { recursive: true });
  for (const work of backup.database.works) for (const chapter of [...work.chapters, ...(work.deletedChapters || [])]) {
    for (const revision of chapter.revisions || []) {
      const original = history[revision.id]; const nextId = createId("revision");
      await fsp.writeFile(path.join(workspaceService.historyDir, `${nextId}.json`), JSON.stringify(original), { flag: "wx" });
      revision.id = nextId;
    }
  }
  for (const task of backup.database.tasks || []) if (!["completed", "failed", "cancelled", "interrupted"].includes(task.status)) task.status = "interrupted";
  await fsp.mkdir(COVER_DIR, { recursive: true });
  const coverPathMap = new Map();

  for (const [fileName, buffer] of Object.entries(backup.covers)) {
    const extension = path.extname(fileName).toLowerCase();
    const restoredName = `restore-${backupTimestamp()}-${createId("cover").slice(-8)}${extension}`;
    await fsp.writeFile(path.join(COVER_DIR, restoredName), buffer);
    coverPathMap.set(fileName, `${COVER_URL_PREFIX}/${restoredName}`);
  }

  for (const work of backup.database.works) {
    if (!work || typeof work !== "object") {
      continue;
    }
    const fileName = localCoverFileName(work.cover);
    if (fileName && coverPathMap.has(fileName)) {
      work.cover = coverPathMap.get(fileName);
    }
    work.coverHistory = normalizeCoverHistory(work.coverHistory).map((item) => {
      const itemFileName = localCoverFileName(item.cover);
      return itemFileName && coverPathMap.has(itemFileName)
        ? { ...item, cover: coverPathMap.get(itemFileName) }
        : item;
    });
    ensureCoverHistory(work);
    for (const chapter of work.chapters || []) {
      const rewriteLocalCoverPath = (input) => String(input || "").replace(/\/data\/covers\/([^\s)]+)/g, (full, name) => {
        const original = validateBackupCoverName(name);
        return original && coverPathMap.has(original) ? coverPathMap.get(original) : full;
      });
      chapter.content = rewriteLocalCoverPath(chapter.content);
      if (chapter.richContent && Array.isArray(chapter.richContent.ops)) {
        chapter.richContent.ops = chapter.richContent.ops.map((op) => typeof op?.insert === "string"
          ? { ...op, insert: rewriteLocalCoverPath(op.insert) }
          : op);
      }
    }
  }

  backup.database.storeRevision = restoreBase;
  await writeDb(backup.database, { automaticBackup: false });
  return {
    previousBackup: path.basename(previousBackup),
    workCount: backup.database.works.length,
    coverCount: coverPathMap.size
  };
}

async function saveCoverBuffer(workId, image) {
  if (image.buffer.length > COVER_MAX_BYTES) {
    const error = new Error("Cover image is too large");
    error.status = 413;
    throw error;
  }

  await fsp.mkdir(COVER_DIR, { recursive: true });
  const fileName = createCoverFileName(workId, image.extension);
  await fsp.writeFile(path.join(COVER_DIR, fileName), image.buffer);
  return `${COVER_URL_PREFIX}/${fileName}`;
}

async function saveIllustrationBuffer(workId, chapterId, image) {
  if (image.buffer.length > COVER_MAX_BYTES) {
    const error = new Error("章节插图不能超过 25MB。");
    error.status = 413;
    throw error;
  }

  await fsp.mkdir(COVER_DIR, { recursive: true });
  const fileName = createIllustrationFileName(workId, chapterId, image.extension);
  await fsp.writeFile(path.join(COVER_DIR, fileName), image.buffer);
  return `${COVER_URL_PREFIX}/${fileName}`;
}

async function saveWallpaperBuffer(image) {
  if (image.buffer.length > WALLPAPER_MAX_BYTES) {
    const error = new Error("壁纸图片不能超过 25MB。");
    error.status = 413;
    throw error;
  }

  await fsp.mkdir(WALLPAPER_DIR, { recursive: true });
  const fileName = createWallpaperFileName(image.extension);
  await fsp.writeFile(path.join(WALLPAPER_DIR, fileName), image.buffer);
  return `${WALLPAPER_URL_PREFIX}/${fileName}`;
}

async function saveRemoteWallpaperImage(imageUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`无法下载生成的壁纸：${response.status}`);
      error.status = 502;
      throw error;
    }

    const mime = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const extension = imageExtensionForMime(mime) || getExtensionFromImageUrl(imageUrl);
    if (!extension || !imageMimeForExtension(extension)) {
      const error = new Error("生成的壁纸类型不受支持。");
      error.status = 502;
      throw error;
    }
    return saveWallpaperBuffer({
      buffer: Buffer.from(await response.arrayBuffer()),
      mime: imageMimeForExtension(extension),
      extension
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function saveWallpaperImage(imageValue) {
  const value = String(imageValue || "").trim();
  const dataImage = parseImageDataUrl(value);
  if (dataImage) {
    return saveWallpaperBuffer(parseUploadedWallpaper(value));
  }
  if (/^https?:\/\//i.test(value)) {
    return saveRemoteWallpaperImage(value);
  }
  const error = new Error("图片模型没有返回可保存的壁纸数据。");
  error.status = 502;
  throw error;
}

async function saveRemoteCoverImage(workId, imageUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`Could not download generated cover image: ${response.status}`);
      error.status = 502;
      throw error;
    }

    const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const extension = imageExtensionForMime(contentType) || getExtensionFromImageUrl(imageUrl);
    const mime = imageExtensionForMime(contentType) ? contentType : imageMimeForExtension(extension);

    if (!extension || !mime) {
      const error = new Error("Generated cover image type is not supported");
      error.status = 502;
      throw error;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return saveCoverBuffer(workId, { buffer, mime, extension });
  } finally {
    clearTimeout(timeout);
  }
}

async function saveCoverImage(workId, imageValue) {
  const value = String(imageValue || "").trim();
  if (!value) {
    return "";
  }

  const dataImage = parseImageDataUrl(value);
  if (dataImage) {
    return saveCoverBuffer(workId, dataImage);
  }

  if (/^https?:\/\//i.test(value)) {
    return saveRemoteCoverImage(workId, value);
  }

  return value;
}

async function migrateCoverStorage(db) {
  let changed = false;
  for (const work of db.works || []) {
    if (!work || typeof work !== "object") {
      continue;
    }
    if (/^data:image\//i.test(String(work.cover || ""))) {
      work.cover = await saveCoverImage(work.id, work.cover);
      changed = true;
    }
    const rawHistory = Array.isArray(work.coverHistory) ? work.coverHistory : [];
    for (const item of rawHistory) {
      if (item && typeof item === "object" && /^data:image\//i.test(String(item.cover || ""))) {
        item.cover = await saveCoverImage(work.id, item.cover);
        changed = true;
      }
    }
    const before = JSON.stringify(work.coverHistory || []);
    ensureCoverHistory(work);
    if (JSON.stringify(work.coverHistory) !== before) {
      changed = true;
    }
  }

  return { db, changed };
}

function getOpenAiKey() {
  loadLocalEnv(ENV_FILE);
  return process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "";
}

function getOpenAiMaxOutputTokens() {
  loadLocalEnv(ENV_FILE);
  return Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 3200);
}

function getMaxOutputTokens() {
  return getOpenAiMaxOutputTokens();
}

function getOpenAiTimeoutMs() {
  loadLocalEnv(ENV_FILE);
  return Number(process.env.OPENAI_TIMEOUT_MS || 30000);
}

function getOpenAiBaseUrl() {
  loadLocalEnv(ENV_FILE);
  return String(process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
}

function getApiRoot(baseUrl) {
  return String(baseUrl || DEFAULT_OPENAI_BASE_URL)
    .replace(/\/+$/, "")
    .replace(/\/responses$/, "")
    .replace(/\/chat\/completions$/, "")
    .replace(/\/images\/generations$/, "");
}

function isTestAiEnabled() {
  return process.env.MOTAI_TEST_AI === "1";
}

function aiUnavailableError(message = "AI 不可用：尚未配置 API Key。请打开 AI 设置完成配置并测试连接。") {
  const error = new Error(message);
  error.status = 503;
  return error;
}

function getNetworkErrorMessage(error, baseUrl = getOpenAiBaseUrl()) {
  const cause = error.cause || {};
  const code = cause.code || error.code || "";

  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") {
    return `连接 OpenAI API 超时：${baseUrl}。这通常是本机网络、代理或防火墙无法访问 api.openai.com。请确认当前网络允许后端程序访问 OpenAI API，或在 .env.local 中配置可用的 OPENAI_BASE_URL。`;
  }

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `无法解析 OpenAI API 地址：${baseUrl}。请检查 DNS、网络或代理设置。`;
  }

  if (code === "ECONNRESET" || code === "ECONNREFUSED") {
    return `连接 OpenAI API 被中断：${baseUrl}。请检查网络、代理或防火墙设置。`;
  }

  if (error.name === "TypeError" && String(error.message || "").includes("fetch failed")) {
    return `无法连接 OpenAI API：${baseUrl}。请检查网络、代理或 OPENAI_BASE_URL 配置。`;
  }

  return "";
}

function limitText(text, maxLength) {
  const value = String(text || "");
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.floor(maxLength * 0.35))}\n\n...[中间内容已省略]...\n\n${value.slice(-Math.floor(maxLength * 0.65))}`;
}

async function fetchAiJson(url, apiKey, requestBody, signal) {
  if (url.endsWith("/chat/completions")) requestBody = applyDeepSeekThinking(requestBody);
  const ctx = taskContext.getStore();
  if (ctx?.signal) signal = signal ? AbortSignal.any([signal, ctx.signal]) : ctx.signal;
  const usageId = createId("usage"), started = Date.now();
  const reserved = JSON.stringify(requestBody).length + Number(requestBody.max_tokens || requestBody.max_output_tokens || 0);
  await dataStore.transact(db => {
    db.usage ||= []; db.settings ||= { dailyTokenLimit: 200000 };
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    const used = db.usage.filter(u => u.day === day).reduce((n, u) => n + (u.totalTokens ?? u.reserved), 0);
    if (used + reserved > db.settings.dailyTokenLimit) fail("今日 AI 用量已达到上限，请在用量面板查看。", 429);
    db.usage.push({ id: usageId, day, taskId: ctx?.taskId || "", workId: ctx?.workId || "", stage: ctx?.stage || "other", model: requestBody.model, reserved, status: "pending", createdAt: nowIso() });
  });
  const finishUsage = async values => dataStore.transact(db => { const u = db.usage.find(u => u.id === usageId); Object.assign(u, values, { durationMs: Date.now() - started }); });
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    await finishUsage({ status: "unknown", errorCategory: error.name });
    const message = error.name === "AbortError"
      ? `连接 AI 接口超时：${url}。当前网络可能无法直连。`
      : getNetworkErrorMessage(error, url);

    if (message) {
      const wrapped = new Error(message);
      wrapped.status = 502;
      throw wrapped;
    }

    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  const parsedUsage = parseTextResponse(url.endsWith("/chat/completions") ? "deepseek" : "openai", payload);
  await finishUsage({ status: response.ok ? "completed" : "failed", responseId: parsedUsage.responseId, model: payload.model || requestBody.model,
    ...(payload.usage ? parsedUsage.usage : response.ok ? {} : { totalTokens: 0 }), errorCategory: response.ok ? "" : `http_${response.status}` });
  if (!response.ok) {
    const rawMessage = payload.error?.message || payload.message || `AI request failed with status ${response.status}`;
    const message = response.status === 401
      ? "AI API Key 无效、已过期或没有权限。请在“接口”页重新填写并保存可用的 Key。"
      : response.status === 403
      ? "当前账号无权使用该模型或接口。请更换已开通的模型，或检查服务商账号权限。"
      : response.status === 429
      ? "AI 服务额度不足或请求过于频繁。请检查账户余额/Token 配额，稍后再试。"
      : url.includes("/images/generations") && response.status === 404
      ? "当前 API 地址不支持图片生成接口 /images/generations。请使用支持图片生成的 OpenAI 兼容接口，或在接口配置中改成 OpenAI 官方地址并配置可用的图片模型。"
      : response.status === 404
      ? "AI 接口地址或请求类型不匹配。请检查 Base URL、接口类型（Responses/Chat）和模型名称。"
      : rawMessage.includes("model")
      ? `${rawMessage}。如果是模型不可用，请在 AI 设置里换成你账号可用的模型。`
      : rawMessage;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

function getImageModel() {
  loadLocalEnv(ENV_FILE);
  return process.env.IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function splitCoverTitle(value) {
  const title = normalizeText(value) || "未命名作品";
  const chunks = [];
  for (let index = 0; index < title.length; index += 10) {
    chunks.push(title.slice(index, index + 10));
  }
  return chunks.slice(0, 3);
}

function splitCoverLogline(value) {
  const plainText = normalizeText(value)
    .replace(/\s+/g, " ")
    .split(/[。！!？?；;]/)[0]
    .trim();
  const logline = plainText || "故事从这一页开始，命运正在等待被改写。";
  const clipped = logline.length > 34 ? `${logline.slice(0, 33)}…` : logline;
  const chunks = [];
  for (let index = 0; index < clipped.length; index += 17) {
    chunks.push(clipped.slice(index, index + 17));
  }
  return chunks.slice(0, 2);
}

async function readGeneratedImage(imageValue) {
  const dataImage = parseImageDataUrl(imageValue);
  if (dataImage) {
    return dataImage;
  }

  const imageUrl = String(imageValue || "").trim();
  if (!/^https?:\/\//i.test(imageUrl)) {
    const error = new Error("图片模型没有返回可保存的封面图片。");
    error.status = 502;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`无法下载生成的封面：${response.status}`);
      error.status = 502;
      throw error;
    }
    const mime = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const extension = imageExtensionForMime(mime) || getExtensionFromImageUrl(imageUrl);
    if (!extension || !imageMimeForExtension(extension)) {
      const error = new Error("生成的封面图片类型不受支持。");
      error.status = 502;
      throw error;
    }
    return { buffer: Buffer.from(await response.arrayBuffer()), mime: imageMimeForExtension(extension), extension };
  } finally {
    clearTimeout(timeout);
  }
}

function getCoverPalette(value) {
  const palette = normalizeCoverStyle({ palette: value }).palette;
  const palettes = {
    gold: { accent: "#e9c46a", accentSoft: "#f5d887", panelStart: "#07151f", panelEnd: "#090b16", title: "#fffaf0", author: "#d8e0e6" },
    teal: { accent: "#48d6cb", accentSoft: "#b9fff6", panelStart: "#062127", panelEnd: "#07111c", title: "#efffff", author: "#c7e8e9" },
    rose: { accent: "#ff829f", accentSoft: "#ffd1dc", panelStart: "#29111c", panelEnd: "#130c17", title: "#fff7fa", author: "#eed5dd" },
    ink: { accent: "#b6c8e8", accentSoft: "#e2ecff", panelStart: "#101827", panelEnd: "#080c14", title: "#f6f8ff", author: "#d7deee" }
  };
  return palettes[palette];
}

async function createTypographicCover(work, imageValue) {
  const image = await readGeneratedImage(imageValue);
  const style = normalizeCoverStyle(work.coverStyle);

  // A finished cover may already contain all text. Keep it as the original image when every overlay is disabled.
  if (!style.showTitle && !style.showMetadata && !style.showLogline && !style.showAuthor) {
    return saveCoverBuffer(work.id, image);
  }

  if (image.buffer.length > Math.floor(COVER_MAX_BYTES * 0.72)) {
    const error = new Error("生成的封面图片过大，无法加入书名排版。请更换较小尺寸后重试。");
    error.status = 413;
    throw error;
  }

  const palette = getCoverPalette(style.palette);
  const titleX = style.titleAlign === "center" ? 512 : 92;
  const titleAnchor = style.titleAlign === "center" ? "middle" : "start";
  const titleLines = splitCoverTitle(work.title);
  const title = titleLines.map((line, index) => `<tspan x="${titleX}" dy="${index === 0 ? 0 : 90}">${escapeXml(line)}</tspan>`).join("");
  const author = escapeXml(normalizeText(work.author) || "未署名");
  const genre = escapeXml(normalizeText(work.genre) || "原创");
  const tags = Array.isArray(work.tags)
    ? work.tags.map((tag) => normalizeText(tag)).filter(Boolean).slice(0, 3)
    : [];
  const categoryText = [normalizeText(work.genre) || "原创", ...tags].join(" · ");
  const category = escapeXml(categoryText.length > 18 ? `${categoryText.slice(0, 17)}…` : categoryText);
  const logline = splitCoverLogline(normalizeText(work.coverLogline) || work.premise)
    .map((line, index) => `<tspan x="116" dy="${index === 0 ? 0 : 42}">${escapeXml(line)}</tspan>`)
    .join("");
  const source = `data:${image.mime};base64,${image.buffer.toString("base64")}`;
  const metadataBlock = style.showMetadata ? `<rect x="88" y="94" width="410" height="54" rx="27" fill="#08111b" fill-opacity="0.76" stroke="${palette.accent}" stroke-opacity="0.78"/>
  <text x="116" y="130" fill="${palette.accentSoft}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="25" font-weight="700" letter-spacing="2">${category}</text>
  <rect x="92" y="182" width="88" height="6" rx="3" fill="${palette.accent}"/>` : "";
  const titleBlock = style.showTitle ? `<text x="${titleX}" y="300" text-anchor="${titleAnchor}" fill="${palette.title}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="76" font-weight="800" letter-spacing="1">${title}</text>` : "";
  const loglinePanel = style.showLogline ? `<rect x="72" y="1210" width="880" height="234" rx="22" fill="url(#panel)" stroke="#fffaf0" stroke-opacity="0.17"/>
  <text x="116" y="1272" fill="${palette.accentSoft}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="23" font-weight="700" letter-spacing="4">故事导语</text>
  <text x="116" y="1330" fill="${palette.title}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="34" font-weight="600">${logline}</text>
  <line x1="116" y1="1386" x2="908" y2="1386" stroke="${palette.title}" stroke-opacity="0.24" stroke-width="2"/>` : "";
  const authorY = style.showLogline ? 1427 : 1412;
  const authorBlock = style.showAuthor ? `<text x="116" y="${authorY}" fill="${palette.author}" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="27" letter-spacing="2">作者 · ${author}</text>` : "";
  const genreBlock = style.showMetadata ? `<text x="908" y="${authorY}" fill="${palette.accentSoft}" text-anchor="end" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="25" font-weight="700" letter-spacing="2">${genre}</text>` : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">
  <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05080d" stop-opacity="0.58"/><stop offset="0.4" stop-color="#05080d" stop-opacity="0.04"/><stop offset="1" stop-color="#05080d" stop-opacity="0.88"/></linearGradient><linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.panelStart}" stop-opacity="0.88"/><stop offset="1" stop-color="${palette.panelEnd}" stop-opacity="0.8"/></linearGradient></defs>
  <image href="${source}" x="0" y="0" width="1024" height="1536" preserveAspectRatio="xMidYMid slice"/>
  <rect width="1024" height="1536" fill="url(#shade)"/>
  ${metadataBlock}
  ${titleBlock}
  ${loglinePanel}
  ${authorBlock}
  ${genreBlock}
</svg>`;
  return saveCoverBuffer(work.id, {
    buffer: Buffer.from(svg, "utf8"),
    mime: "image/svg+xml",
    extension: ".svg"
  });
}

function buildImagePrompt(work, prompt) {
  const storyBible = normalizeStoryBible(work.storyBible);
  const direction = normalizeText(prompt) || "中文网络小说封面，电影海报质感，强烈光影，主体人物清晰";
  return [
    "请使用图片生成模型生成一张正式的原创小说封面图，竖版 2:3 构图，适合中文小说网站封面。",
    "画面必须像真正的小说封面或动漫电影宣传海报，不要抽象几何占位图，不要软件界面截图，不要网页 UI，不要水印，不要官方 logo。",
    "不要直接复刻任何已有动漫、影视、游戏角色或商标；如果是同人题材，只保留题材气质、世界观氛围和原创角色外观。",
    "主体要具体：至少包含一个原创主角剪影或半身像、明确场景、力量/科技/时代元素、冲突气氛。",
    "",
    `作品名：${work.title || "未命名作品"}`,
    `类型：${work.genre || "原创"}`,
    `标签：${Array.isArray(work.tags) ? work.tags.join("，") : ""}`,
    `一句话梗概：${limitText(work.premise || "", 280)}`,
    `封面方向：${direction}`,
    "",
    storyBible.worldview && `世界观：${limitText(storyBible.worldview, 380)}`,
    storyBible.characters && `人物：${limitText(storyBible.characters, 340)}`,
    storyBible.factions && `势力/组织：${limitText(storyBible.factions, 260)}`,
    storyBible.conflict && `主线冲突：${limitText(storyBible.conflict, 260)}`,
    storyBible.chapterPlan && `章节规划参考：${limitText(storyBible.chapterPlan, 360)}`,
    "",
    "画面要求：主体明确，背景有世界观信息；顶部和底部要有可读文字的干净留白。墨台会在生成后叠加准确的书名和作者名，所以画面中不要生成任何可读文字、水印或假标题。风格贴合封面方向，避免空泛蓝色渐变、三角形、圆形等模板装饰。"
  ].filter(Boolean).join("\n");
}

function buildChapterIllustrationPrompt(work, chapter, prompt) {
  const storyBible = normalizeStoryBible(work.storyBible);
  const direction = normalizeText(prompt) || "选择当前章节最具画面感、最能推动剧情的一瞬间";
  const chapterPlan = findRelevantChapterPlan(storyBible.chapterPlan, chapter?.title);
  return [
    "请生成一张用于中文长篇小说正文中的章节插图，横向 16:9 构图。",
    "画面必须是叙事插画：人物、场景、动作和情绪要具体，能让读者理解当前剧情。不要软件界面、边框、可读文字、水印、商标或海报排版。",
    "若作品为同人题材，只保留世界观气质与原创外观，禁止复刻官方角色、商标或截图。",
    `作品名：${work.title || "未命名作品"}`,
    `类型：${work.genre || "原创"}`,
    `一句话梗概：${limitText(work.premise || "", 260)}`,
    `当前章节：${chapter?.title || "未命名章节"}`,
    `当前正文片段：${limitText(chapter?.content || "", 900) || "尚未开始正文，请按本章规划构图。"}`,
    chapterPlan && `当前应推进的章节规划：${chapterPlan}`,
    storyBible.worldview && `世界观：${limitText(storyBible.worldview, 450)}`,
    storyBible.characters && `人物设定：${limitText(storyBible.characters, 450)}`,
    storyBible.locations && `地点：${limitText(storyBible.locations, 260)}`,
    storyBible.continuityNotes && `连续性提醒：${limitText(storyBible.continuityNotes, 280)}`,
    `作者指定画面：${direction}`,
    "请只画一个清晰、富有小说感的瞬间，主体位于中景或前景，留出适量环境信息。"
  ].filter(Boolean).join("\n");
}

async function generateImageData(imagePrompt, size = "1024x1536") {
  const config = getImageConfig(true);
  if (!config.configured) {
    const error = new Error("未配置图片生成 API。请在接口配置里填写图片 API Key，或使用本身支持图片生成的 OpenAI/自定义兼容接口。");
    error.status = 400;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const model = config.model;

  try {
    const payload = await fetchAiJson(`${getApiRoot(config.baseUrl)}/images/generations`, config.apiKey, {
      model,
      prompt: imagePrompt,
      size,
      n: 1
    }, controller.signal);
    const image = payload?.data?.[0] || {};
    const dataUrl = image.b64_json
      ? `data:image/png;base64,${image.b64_json}`
      : image.url || "";

    if (!dataUrl) {
      const error = new Error("图片模型没有返回图片数据。");
      error.status = 502;
      throw error;
    }

    return {
      image: dataUrl,
      prompt: imagePrompt,
      model,
      provider: config.reusesTextApi ? "text-api" : "image-api",
      fallback: false
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callImageGenerator(work, prompt) {
  const imagePrompt = buildImagePrompt(work, prompt);
  const result = await generateImageData(imagePrompt, "1024x1536");
  return {
    cover: result.image,
    coverPrompt: result.prompt,
    model: result.model,
    provider: result.provider,
    fallback: false
  };
}

async function callChapterIllustrationGenerator(work, chapter, prompt) {
  const imagePrompt = buildChapterIllustrationPrompt(work, chapter, prompt);
  const result = await generateImageData(imagePrompt, "1536x1024");
  const image = await readGeneratedImage(result.image);
  return {
    image: await saveIllustrationBuffer(work.id, chapter.id, image),
    prompt: result.prompt,
    model: result.model,
    provider: result.provider
  };
}

async function callSiteArtGenerator(prompt) {
  const direction = normalizeText(prompt) || "中文小说创作平台首页主视觉，现代写作工作台，小说封面墙，温暖灯光，轻微国风纹理，不要文字水印";
  const imagePrompt = [
    "请使用图片生成模型生成一张竖版 4:5 的网站首页主视觉图，适合放在中文 AI 小说写作平台首页右侧展示卡。",
    "画面不是小说封面，也不是 UI 截图；应该是有氛围的创作场景、书桌、手稿、书架、柔和灯光和少量东方纹样。",
    "不要出现可读文字、水印、商标、真实品牌 logo。不要空泛渐变背景。",
    "整体气质：现代、沉浸、适合长篇小说作者，既有科技感也有中文网文创作氛围。",
    `用户方向：${direction}`
  ].join("\n");
  const result = await generateImageData(imagePrompt, "1536x1024");
  return {
    cover: result.image,
    coverPrompt: result.prompt,
    model: result.model,
    provider: result.provider,
    fallback: false
  };
}

function buildWallpaperPrompt(prompt, theme, work) {
  const direction = normalizeText(prompt) || "沉浸式中文小说写作工作台，书桌、手稿、书架与柔和光影";
  const themeDirection = {
    light: "晨光、象牙白与淡青色，明亮但不刺眼，国风书案与干净留白",
    dark: "近黑墨色、雨夜窗景与砚台，低干扰、高对比，避免绿色偏色",
    midnight: "深蓝星幕、未来感书桌与星图，安静克制、适合科幻和幻想创作",
    paper: "琥珀暖光、深色书架与夜读书房，纸张质感、温暖而沉稳"
  }[theme] || "适配深色中文写作软件的沉浸式创作场景";

  const storyBible = normalizeStoryBible(work?.storyBible);
  const workContext = work ? [
    "以下作品资料只用于画面叙事气质；不要在壁纸中画出书名、作者、可读文字或封面排版。",
    `作品名：${work.title || "未命名作品"}`,
    `类型：${work.genre || "原创"}`,
    `标签：${Array.isArray(work.tags) ? work.tags.join("，") : ""}`,
    `梗概：${limitText(work.premise || "", 220)}`,
    storyBible.worldview && `世界观：${limitText(storyBible.worldview, 260)}`,
    storyBible.characters && `人物：${limitText(storyBible.characters, 220)}`,
    storyBible.conflict && `核心冲突：${limitText(storyBible.conflict, 180)}`
  ].filter(Boolean) : [];

  return [
    "请生成横向 16:9 的中文小说写作软件工作台壁纸。",
    "画面只作为应用背景：主体集中在右侧或边缘，左侧和中部预留干净暗部或浅色区域，方便叠加文字与编辑面板。",
    "不要出现可读文字、水印、商标、品牌 logo、人物肖像或软件界面截图。不要抽象色块或默认渐变。",
    `主题氛围：${themeDirection}。`,
    ...workContext,
    `用户方向：${direction}`,
    "画面应是精致、有故事感的真实环境或高质量插画；对比度受控，不能影响界面文字可读性。"
  ].join("\n");
}

async function callWallpaperGenerator(prompt, theme, work) {
  const result = await generateImageData(buildWallpaperPrompt(prompt, theme, work), "1536x1024");
  const imagePath = await saveWallpaperImage(result.image);
  return {
    image: imagePath,
    prompt: result.prompt,
    model: result.model,
    provider: result.provider,
    fallback: false
  };
}

function extractChatText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        return part?.text || part?.content || "";
      })
      .join("")
      .trim();
  }

  return "";
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") {
    return payload.output_text.trim();
  }

  const chunks = [];
  for (const item of payload?.output || []) {
    if (typeof item?.text === "string") {
      chunks.push(item.text);
    }

    for (const part of item?.content || []) {
      if (typeof part?.text === "string") {
        chunks.push(part.text);
      } else if (typeof part?.content === "string") {
        chunks.push(part.content);
      }
    }
  }

  return chunks.join("").trim();
}

async function fetchAiModels(config, signal) {
  const request = buildModelListRequest(config);
  let response;
  try {
    response = await fetch(request.url, { method: request.method, headers: request.headers, signal });
  } catch (error) {
    const message = error.name === "AbortError" ? `连接 AI 接口超时：${request.url}。` : getNetworkErrorMessage(error, request.url);
    if (message) {
      const wrapped = new Error(message);
      wrapped.status = 502;
      throw wrapped;
    }
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.message || `获取模型列表失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return extractModelIds(payload);
}

async function listSelectableAiModels() {
  if (isTestAiEnabled()) {
    return {
      models: [
        { provider: "deepseek", providerLabel: "DeepSeek", id: "deepseek-chat" },
        { provider: "openai", providerLabel: "OpenAI", id: "gpt-5.5" }
      ],
      errors: []
    };
  }

  const results = await Promise.all(Object.keys(PROVIDERS).map(async (provider) => {
    const config = getAiConfig(true, provider);
    if (!config.apiKey) return { provider, models: [], error: "运行环境尚未配置" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 10000));
    try {
      const ids = await fetchAiModels(config, controller.signal);
      return {
        provider,
        models: ids.filter((id) => isSupportedWritingModel(provider, id)).map((id) => ({
          provider,
          providerLabel: config.providerLabel,
          id
        }))
      };
    } catch (error) {
      return { provider, models: [], error: error.message || "无法获取模型列表" };
    } finally {
      clearTimeout(timeout);
    }
  }));

  return {
    models: results.flatMap((result) => result.models),
    errors: results.filter((result) => result.error).map(({ provider, error }) => ({ provider, message: error }))
  };
}

async function testAiConnection(providerValue) {
  const config = getAiConfig(true, providerValue);

  if (isTestAiEnabled()) {
    return {
      ok: true,
      message: "测试模型连接成功。",
      provider: config.provider,
      endpoint: "test",
      model: "测试模型",
      checkedAt: nowIso()
    };
  }

  if (!config.apiKey) {
    return {
      ok: false,
      message: "AI 服务尚未由运行环境配置，请联系应用管理员。",
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const models = await fetchAiModels(config, controller.signal);
    const model = selectWritingModel(config.provider, models, config.model);
    if (!model) {
      throw new Error(`${config.providerLabel} 账号没有返回可用于小说写作的文本模型。`);
    }
    const testPrompt = "请只回复：连接成功";
    const request = buildTextRequest({ provider: config.provider, apiKey: config.apiKey, model, baseUrl: config.baseUrl, userPrompt: testPrompt, maxOutputTokens: 32 });
    const payload = await fetchAiJson(request.url, config.apiKey, request.body, controller.signal);
    const text = parseTextResponse(config.provider, payload).text;

    if (!text) {
      return {
        ok: false,
        message: "接口已响应，但没有返回文本。请检查模型和接口类型是否匹配。",
        provider: config.provider,
        endpoint: config.endpoint,
        model
      };
    }

    const checkedAt = nowIso();
    providerRuntimeStatus.set(config.provider, { available: true, model, message: `${config.providerLabel} 连接成功。`, checkedAt });

    return {
      ok: true,
      message: `${config.providerLabel || config.provider} 连接成功。`,
      provider: config.provider,
      endpoint: config.endpoint,
      model,
      checkedAt
    };
  } catch (error) {
    const checkedAt = nowIso();
    providerRuntimeStatus.set(config.provider, { available: false, model: config.model, message: error.message || "连接失败。", checkedAt });
    return {
      ok: false,
      message: error.message || "连接失败。",
      provider: config.provider,
      endpoint: config.endpoint,
      model: config.model,
      checkedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAiWriter(body) {
  const config = getAiConfig(true);
  const apiKey = config.apiKey;
  const model = config.model;
  const boldness = clampNumber(body.work?.boldness, 0, 100, 50);
  const temperature = temperatureFromBoldness(boldness);

  if (isTestAiEnabled()) {
    return buildTestAiResult(body);
  }

  if (!apiKey) {
    throw aiUnavailableError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const prompt = buildAiPrompt(body);
  const systemText = "你是专业的中文小说写作助手，擅长续写、润色、扩写、章节大纲和剧情构思。你尊重作者原有设定，避免替作者擅自改变核心剧情。";

  try {
    let payload;
    let text = "";

    if (config.endpoint === "chat") {
      payload = await fetchAiJson(`${config.baseUrl}/chat/completions`, apiKey, {
        model,
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: prompt }
        ],
        max_tokens: config.maxOutputTokens,
        temperature
      }, controller.signal);
      text = extractChatText(payload);
    } else {
      const requestBody = {
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: systemText
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt
              }
            ]
          }
        ],
        max_output_tokens: config.maxOutputTokens,
        temperature
      };

      if (/^(gpt-5|o[0-9])/.test(model)) {
        requestBody.reasoning = { effort: "low" };
      }

      if (/^gpt-5/.test(model)) {
        requestBody.text = { verbosity: "medium" };
      }

      payload = await fetchAiJson(`${config.baseUrl}/responses`, apiKey, requestBody, controller.signal);
      text = extractResponseText(payload);
    }

    if (!text) {
      const error = new Error("AI 不可用：接口已响应，但没有返回内容。请检查模型和接口类型。");
      error.status = 502;
      throw error;
    }

    const parsedResponse = parseTextResponse(config.provider, payload);
    return { text, model: parsedResponse.model || model, provider: config.provider, endpoint: config.endpoint, usage: parsedResponse.usage };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonObject(text) {
  const value = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return {};
  }
}

function continuityContextText(context) {
  const facts = context.canonFacts.map((fact) => `- [${fact.strength}] ${fact.predicate}：${fact.value || fact.objectId}`).join("\n");
  const memories = context.chapterMemories.map((memory) => `- 第${memory.chapterOrder + 1}章：${memory.summary}${memory.timeLabel ? `（时间：${memory.timeLabel}）` : ""}`).join("\n");
  return [
    "已确认事实（hard 不得违反，soft 尽量保持）：",
    facts || "- 暂无已确认结构化事实",
    "最近章节记忆：",
    memories || "- 暂无已确认章节记忆"
  ].join("\n");
}

function detectRuleConflicts(chapter, candidate) {
  const source = String(chapter?.content || "");
  const paragraphs = String(candidate || "").split(/\n+/).map((item) => item.trim()).filter((item) => item.length >= 24);
  const seen = new Set();
  const conflicts = [];
  for (const paragraph of paragraphs) {
    const repeatedInDraft = seen.has(paragraph);
    const repeatedInChapter = source.includes(paragraph);
    seen.add(paragraph);
    if (!repeatedInDraft && !repeatedInChapter) continue;
    conflicts.push(normalizeConflict({
      id: createId("conflict"),
      category: "repetition",
      severity: "hard",
      status: "open",
      detectedBy: "rule",
      message: repeatedInChapter ? "生成内容重复了当前章节中已有的完整段落。" : "生成内容内部出现了重复段落。",
      evidence: [{ chapterId: chapter.id, excerpt: paragraph.slice(0, 240) }],
      createdAt: nowIso()
    }));
  }
  return conflicts;
}

async function analyzeGeneratedText(work, chapter, candidate, context) {
  if (isTestAiEnabled()) {
    return {
      conflicts: [],
      chapterMemory: {
        status: "confirmed",
        sourceContentHash: "",
        summary: String(candidate || "").replace(/\s+/g, " ").slice(0, 280),
        timeLabel: "",
        participantIds: [],
        locationIds: [],
        factIds: [],
        completedEventIds: [],
        openForeshadowingIds: [],
        updatedAt: nowIso()
      },
      facts: []
    };
  }

  const validationBody = {
    mode: "custom",
    work,
    chapter,
    selectedText: candidate,
    instruction: [
      "你现在只做小说连续性审校，不创作正文。严格输出 JSON 对象，不要 Markdown。",
      "格式：{\"conflicts\":[{\"category\":\"timeline|identity|life_status|ability|knowledge|relationship|world_rule|location|event_state|foreshadowing|causality|motivation|voice|other\",\"severity\":\"hard|soft\",\"message\":\"...\",\"excerpt\":\"...\"}],\"chapterMemory\":{\"summary\":\"...\",\"timeLabel\":\"...\"},\"facts\":[{\"category\":\"timeline|identity|life_status|ability|knowledge|relationship|world_rule|location|event_state|foreshadowing|other\",\"predicate\":\"...\",\"value\":\"...\",\"strength\":\"hard|soft\"}]}",
      "hard 仅用于明确违反已确认事实、时间线、死亡状态、已知能力边界或因果不可能；风格建议用 soft。",
      "facts 只提取这段新正文中明确发生且后续章节需要记住的事实，最多 12 条。",
      "chapterMemory.summary 必须总结当前章节已有正文与本次新增内容的完整进展，不要只总结最后一段。",
      "当前章节已有正文：",
      limitText(chapter.content || "", 16000),
      continuityContextText(context)
    ].join("\n")
  };
  const result = await callOpenAiWriter(validationBody);
  const parsed = parseJsonObject(result.text);
  if (!Array.isArray(parsed.conflicts) || !Array.isArray(parsed.facts)
    || !parsed.chapterMemory || typeof parsed.chapterMemory.summary !== "string"
    || !parsed.chapterMemory.summary.trim()
    || parsed.conflicts.some((item) => !item || !["hard", "soft"].includes(item.severity) || typeof item.message !== "string" || !item.message.trim())) {
    const error = new Error("AI 审校未返回有效的检查报告，本次结果不能写入。请重新生成。");
    error.status = 502;
    throw error;
  }
  const conflicts = (Array.isArray(parsed.conflicts) ? parsed.conflicts : []).slice(0, 40).map((item) => normalizeConflict({
    id: createId("conflict"),
    category: item.category,
    severity: item.severity,
    status: "open",
    detectedBy: "ai",
    message: item.message,
    evidence: [{ chapterId: chapter.id, excerpt: item.excerpt }],
    createdAt: nowIso()
  }));
  const facts = (Array.isArray(parsed.facts) ? parsed.facts : []).slice(0, 12).map((item) => ({
    id: createId("fact"),
    category: item.category,
    subjectId: "",
    predicate: normalizeText(item.predicate).slice(0, 120),
    value: normalizeText(item.value).slice(0, 4000),
    objectId: "",
    strength: item.strength === "soft" ? "soft" : "hard",
    status: "active",
    sourceChapterId: chapter.id,
    effectiveOrder: Math.max(0, (work.chapters || []).findIndex((item) => item.id === chapter.id)),
    createdAt: nowIso(),
    updatedAt: nowIso()
  })).filter((fact) => fact.predicate || fact.value);
  return {
    conflicts,
    facts,
    chapterMemory: normalizeChapterMemory({
      status: "confirmed",
      sourceContentHash: "",
      summary: parsed.chapterMemory?.summary || String(candidate || "").replace(/\s+/g, " ").slice(0, 600),
      timeLabel: parsed.chapterMemory?.timeLabel || "",
      updatedAt: nowIso()
    })
  };
}

async function reviewChapterTask(input) {
  const db = await readDb(), work = findWork(db, input.workId), chapter = work && findChapter(work, input.chapterId);
  if (!chapter) fail("章节不存在。", 404); ensureVersion(chapter.revision, input.baseRevision);
  const task = taskContext.getStore(); if (task) { task.stage = "review"; await task.update({ status: "checking" }); }
  const context = selectContinuityContext(work, chapter.id);
  const scene = chapter.scenes?.[0];
  context.canonFacts = selectTemporalFacts(work.canon.facts, { storyTime: scene?.storyTime ?? null, readerOrder: work.chapters.findIndex(c => c.id === chapter.id), povId: scene?.povId || "" });
  const analysis = await analyzeGeneratedText(work, { ...chapter, content: "" }, chapter.content, context);
  task?.signal.throwIfAborted();
  return workspaceService.mutate(work.id, chapter.id, input.baseRevision, (w, c) => {
    task?.signal.throwIfAborted(); ensureVersion(w.canonRevision, work.canonRevision);
    const proposal = normalizeCanonProposal({ id: createId("canon_proposal"), chapterId: c.id, generationRecordId: "", status: "pending", sourceRevision: c.revision, changes: analysis.facts.map(f => ({ operation: "add", fact: { ...f, sourceRevision: c.revision } })), chapterMemory: analysis.chapterMemory, createdAt: nowIso() });
    c.chapterMemory = normalizeChapterMemory({ ...analysis.chapterMemory, status: "confirmed", sourceContentHash: hashChapterContent(c) });
    c.chapterMemory.context = { chapterVersions: context.chapterMemoryChapterIds.map(id => ({ id, revision: w.chapters.find(c => c.id === id)?.revision })), factVersions: context.canonFacts.map(f => ({ id: f.id, revision: f.sourceRevision })) };
    w.canonProposals.push(proposal);
    return { chapter: c, work: w, proposal, conflicts: analysis.conflicts };
  });
}

function selectedGenerationOutput(record) {
  const normalized = normalizeGenerationRecord(record);
  const attempt = normalized.attempts.find((item) => item.index === normalized.selectedAttemptIndex) || normalized.attempts.at(-1);
  return attempt?.output || "";
}

async function createConstrainedGeneration(body) {
  const workId = normalizeText(body.workId || body.work?.id);
  const chapterId = normalizeText(body.chapterId || body.chapter?.id);
  const db = await readDb();
  const work = findWork(db, workId);
  const chapter = work && findChapter(work, chapterId);
  if (!work || !chapter) {
    const error = new Error("作品或章节不存在，请刷新后重试。");
    error.status = 404;
    throw error;
  }
  if (body.baseRevision !== undefined) ensureVersion(chapter.revision, body.baseRevision);
  const scene = body.sceneId ? chapter.scenes.find(s => s.id === body.sceneId) : null;
  if (body.sceneId && (!scene || scene.needsRelocation)) fail("场景需要重新定位后才能生成。", 409);
  if (body.baseRevision === undefined && body.baseChapterUpdatedAt && body.baseChapterUpdatedAt !== chapter.updatedAt) {
    const error = new Error("章节已在别处更新，请刷新后重新生成，避免覆盖新内容。");
    error.status = 409;
    throw error;
  }

  const mode = normalizeText(body.mode) || "continue";
  const context = selectContinuityContext(work, chapter.id, { maxFacts: 240, recentChapterCount: 4 });
  context.canonFacts = selectTemporalFacts(work.canon.facts, { storyTime: scene?.storyTime ?? null, readerOrder: work.chapters.findIndex(c => c.id === chapter.id), povId: scene?.povId || "" });
  if (Array.isArray(body.excludeFactIds)) context.canonFacts = context.canonFacts.filter(f => !body.excludeFactIds.includes(f.id) || f.strength === "hard");
  context.canonFactIds = context.canonFacts.map(f => f.id);
  const baseContentHash = hashChapterContent(chapter);
  const attempts = [];
  let analysis = { conflicts: [], facts: [], chapterMemory: normalizeChapterMemory() };
  let result = null;
  const baseInstruction = [normalizeText(body.instruction), scene ? `场景要求：${JSON.stringify(scene)}` : "", `作品写作偏好：${JSON.stringify(work.writingPreferences || {})}`, body.contextNotes ? `作者补充资料：${String(body.contextNotes).slice(0, 8000)}` : ""].filter(Boolean).join("\n");
  let instruction = baseInstruction;
  const task = taskContext.getStore();

  for (let index = 0; index < 3; index += 1) {
    task?.signal.throwIfAborted();
    if (task) { task.stage = index ? "revision" : "generation"; await task.update({ status: "generating" }); }
    const startedAt = nowIso();
    try {
      result = await callOpenAiWriter({
        mode,
        instruction,
        selectedText: String(body.selectedText || ""),
        work,
        chapter,
        continuityContext: context,
        rewriteIssues: analysis.conflicts
      });
      task?.signal.throwIfAborted();
      if (task) { task.stage = "review"; await task.update({ status: "checking", draft: result.text }); }
      const ruleConflicts = detectRuleConflicts(mode === "continue" ? chapter : { ...chapter, content: "" }, result.text);
      analysis = await analyzeGeneratedText(work, chapter, result.text, context);
      analysis.conflicts = [...ruleConflicts, ...analysis.conflicts];
      attempts.push({ index, status: "completed", output: result.text, usage: result.usage || {}, startedAt, finishedAt: nowIso() });
      const hard = analysis.conflicts.filter((item) => item.severity === "hard" && item.status === "open");
      if (!hard.length || index === 2 || body.autoRewrite !== true) break;
      instruction = [baseInstruction, "请重写上一版并解决这些硬冲突：", ...hard.map((item) => `- ${item.message}`)].filter(Boolean).join("\n");
    } catch (error) {
      attempts.push({ index, status: "failed", output: "", error: error.message, startedAt, finishedAt: nowIso() });
      throw error;
    }
  }

  const hasHardConflict = analysis.conflicts.some((item) => item.severity === "hard" && item.status === "open");
  const completedAt = nowIso();
  const record = normalizeGenerationRecord({
    id: createId("generation"),
    chapterId: chapter.id,
    mode,
    status: hasHardConflict ? "blocked" : "ready",
    provider: result?.provider,
    model: result?.model,
    instruction: normalizeText(body.instruction),
    baseContentHash,
    baseRevision: chapter.revision, canonRevision: work.canonRevision, sceneId: scene?.id || "",
    context: { canonFactIds: context.canonFactIds, chapterMemoryChapterIds: context.chapterMemoryChapterIds, factVersions: context.canonFacts.map(f => ({ id: f.id, revision: f.sourceRevision })), chapterVersions: context.chapterMemoryChapterIds.map(id => ({ id, revision: work.chapters.find(c => c.id === id)?.revision })), promptVersion: "continuity-v2" },
    attempts,
    selectedAttemptIndex: attempts.length - 1,
    conflicts: analysis.conflicts,
    rewriteCount: Math.max(0, attempts.length - 1),
    createdAt: attempts[0]?.startedAt || completedAt,
    completedAt
  });
  if (body.range) record.hunks = makeHunks(chapter, body.range, selectedGenerationOutput(record));
  record.conflicts = record.conflicts.map(c => ({ ...c, kind: classifyConflict(c) }));
  let proposal = null;
  if (!hasHardConflict) {
    proposal = normalizeCanonProposal({
      id: createId("canon_proposal"),
      generationRecordId: record.id,
      chapterId: chapter.id,
      status: "pending",
      changes: analysis.facts.map((fact) => ({ operation: "add", targetFactId: "", fact: { ...fact, sourceGenerationId: record.id } })),
      chapterMemory: analysis.chapterMemory,
      createdAt: completedAt
    });
  }

  await dataStore.transact((stored) => {
    task?.signal.throwIfAborted();
    const upgraded = upgradeDatabase(stored).db;
    Object.assign(stored, upgraded);
    const currentWork = findWork(stored, work.id);
    const currentChapter = currentWork && findChapter(currentWork, chapter.id);
    if (!currentChapter || hashChapterContent(currentChapter) !== baseContentHash) {
      const error = new Error("生成期间章节内容已变化，本次结果未保存，请重新生成。");
      error.status = 409;
      throw error;
    }
    currentWork.generationRecords.push(record);
    if (proposal) currentWork.canonProposals.push(proposal);
    currentWork.updatedAt = completedAt;
  });

  return { generation: record, text: selectedGenerationOutput(record), canAccept: canAcceptGeneration(record), fallback: false };
}

function buildChatSystemPrompt(work) {
  const storyBible = compactStoryBible(work.storyBible);
  return [
    "你是墨台里的中文小说创作伙伴。你的首要任务是通过自然对话帮助作者澄清灵感、冲突、人物动机和可执行的大纲。",
    "回答要直接、具体、有创作推动力。信息不足时一次只追问最关键的问题，不要一次抛出长问卷。",
    "不要声称已经修改作品资料；资料写入由界面中的草案确认流程完成。不要展示内部推理过程。",
    "",
    "当前作品：",
    `标题：${work.title || "未命名作品"}`,
    `类型：${work.genre || "原创"}`,
    `创作简介：${work.premise || "暂无"}`,
    "",
    "当前创作资料：",
    storyBible || "暂时为空。请先帮助作者把灵感说清楚。"
  ].join("\n");
}

function buildLocalChatReply(work, input) {
  const text = normalizeText(input);
  if (/大纲|主线|结构/.test(text)) {
    return `我们可以先把《${work.title || "未命名作品"}》的主线压缩成一句话：主角想得到什么、谁在阻止他、失败会失去什么。你可以先告诉我主角眼下最迫切的目标；如果方向已经确定，也可以点右侧“故事大纲”生成一份可确认的草案。`;
  }
  if (/人物|角色|关系/.test(text)) {
    return "人物关系最好从欲望和冲突开始，而不是先堆履历。告诉我你最想写的两个人，他们分别想从对方身上得到什么、又最怕对方知道什么？";
  }
  if (/世界观|规则|设定/.test(text)) {
    return "世界观只需要先确定会真正影响剧情选择的规则。你希望这个世界里哪条规则最让主角为难？我们可以从这条规则向外扩展。";
  }
  if (/时间线|事件|伏笔/.test(text)) {
    return "时间线可以先抓住三个不可逆节点：故事开始前发生了什么、正文中哪次选择改变了一切、结局前必须回收什么。你已经确定其中哪一个？";
  }
  return `我在。我们先不用急着填满所有设定。关于《${work.title || "未命名作品"}》，你现在最想解决的是开头怎么抓人、人物为什么行动，还是整条主线怎么推进？`;
}

function upstreamAiError(response, payload = {}) {
  const raw = payload?.error?.message || payload?.message || `AI request failed with status ${response.status}`;
  const error = new Error(response.status === 401
    ? "AI API Key 无效或没有权限，请检查设置。"
    : response.status === 429
      ? "AI 服务额度不足或请求过于频繁，请稍后重试。"
      : raw);
  error.status = response.status;
  return error;
}

function extractStreamDelta(payload) {
  const chatDelta = payload?.choices?.[0]?.delta?.content;
  if (typeof chatDelta === "string") {
    return chatDelta;
  }
  if (Array.isArray(chatDelta)) {
    return chatDelta.map((part) => part?.text || part?.content || "").join("");
  }
  if (payload?.type === "response.output_text.delta" && typeof payload.delta === "string") {
    return payload.delta;
  }
  return "";
}

async function consumeSseResponse(response, onDelta) {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      const delta = extractStreamDelta(JSON.parse(data));
      if (delta) {
        output += delta;
        onDelta(delta);
      }
    }
    if (done) {
      break;
    }
  }
  return output;
}

async function callConversationStream(work, chat, onDelta, signal) {
  const config = getAiConfig(true);
  const latestUserMessage = [...chat.messages].reverse().find((message) => message.role === "user");
  if (isTestAiEnabled()) {
    const text = buildLocalChatReply(work, latestUserMessage?.content || "");
    for (const chunk of text.match(/.{1,6}/gu) || [text]) {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      onDelta(chunk);
    }
    return { text, provider: "test", warning: "" };
  }
  if (!config.apiKey) {
    throw aiUnavailableError();
  }

  const messages = [
    { role: "system", content: buildChatSystemPrompt(work) },
    ...selectChatContext(chat)
  ];
  const requestBody = config.endpoint === "chat"
    ? {
      model: config.model,
      messages,
      max_tokens: config.maxOutputTokens,
      temperature: temperatureFromBoldness(getWorkBoldness(work)),
      stream: true
    }
    : {
      model: config.model,
      input: messages.map((message) => ({
        role: message.role,
        content: [{ type: message.role === "assistant" ? "output_text" : "input_text", text: message.content }]
      })),
      max_output_tokens: config.maxOutputTokens,
      stream: true
    };
  const endpoint = config.endpoint === "chat" ? "/chat/completions" : "/responses";
  const response = await fetch(`${config.baseUrl}${endpoint}`, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(config.endpoint === "chat" ? applyDeepSeekThinking(requestBody) : requestBody)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw upstreamAiError(response, payload);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const payload = await response.json();
    const text = config.endpoint === "chat" ? extractChatText(payload) : extractResponseText(payload);
    if (text) {
      onDelta(text);
    }
    return { text, provider: config.provider, warning: "该供应商未返回流式内容，已使用兼容模式。" };
  }
  const text = await consumeSseResponse(response, onDelta);
  return { text, provider: config.provider, warning: "" };
}

function sendSseEvent(res, event, payload) {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

async function generateArtifactFields(work, type, instruction = "") {
  const definition = ARTIFACT_DEFINITIONS[type];
  if (!definition) {
    const error = new Error("不支持的创作资料类型");
    error.status = 400;
    throw error;
  }
  const config = getAiConfig(true);
  const fieldNames = Object.keys(definition.fields);
  if (isTestAiEnabled()) {
    const result = buildTestStoryBible(work);
    return Object.fromEntries(fieldNames.map((field) => [field, result.storyBible[field] || ""]));
  }
  if (!config.apiKey) throw aiUnavailableError();
  const prompt = [
    `请为小说《${work.title || "未命名作品"}》优化${definition.label}。`,
    `作品简介：${work.premise || "暂无"}`,
    `当前资料：${compactStoryBible(work.storyBible) || "暂无"}`,
    instruction ? `作者补充要求：${instruction}` : "",
    "输出必须具体、可直接用于长篇创作，不要覆盖作者已经确定的核心事实。"
  ].filter(Boolean).join("\n\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let output;
    if (config.endpoint === "chat") {
      const properties = Object.fromEntries(fieldNames.map((field) => [field, { type: "string", description: definition.fields[field] }]));
      const toolName = "propose_story_artifact";
      const payload = await fetchAiJson(`${config.baseUrl}/chat/completions`, config.apiKey, {
        model: config.model,
        messages: [
          { role: "system", content: "你是中文长篇小说策划编辑。请通过指定工具返回结构化草案。" },
          { role: "user", content: prompt }
        ],
        tools: [{
          type: "function",
          function: {
            name: toolName,
            description: `生成${definition.label}草案`,
            parameters: { type: "object", properties, required: fieldNames, additionalProperties: false }
          }
        }],
        tool_choice: { type: "function", function: { name: toolName } },
        temperature: temperatureFromBoldness(getWorkBoldness(work)),
        max_tokens: config.maxOutputTokens
      }, controller.signal);
      const argumentsText = payload?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      output = argumentsText ? JSON.parse(argumentsText) : extractJsonObject(extractChatText(payload));
    } else {
      const payload = await fetchAiJson(`${config.baseUrl}/responses`, config.apiKey, {
        model: config.model,
        input: `${prompt}\n\n只输出 JSON，字段为：${fieldNames.join("、")}`,
        max_output_tokens: config.maxOutputTokens
      }, controller.signal);
      output = extractJsonObject(extractResponseText(payload));
    }
    return Object.fromEntries(fieldNames.map((field) => [field, String(output?.[field] || "").trim()]));
  } finally {
    clearTimeout(timeout);
  }
}

async function handleStudioWorkspaceApi(req, res, parts, db, work) {
  if (parts[3] === "chats") {
    const workspace = ensureAiWorkspace(work, { createChat: true });
    if (req.method === "GET" && parts.length === 4) {
      await writeDb(db);
      sendJson(res, 200, { activeChatId: workspace.activeChatId, chats: workspace.chats, proposals: workspace.proposals });
      return true;
    }
    if (req.method === "POST" && parts.length === 4) {
      const body = await readBody(req);
      const chat = createChatRecord(body.title);
      workspace.chats.unshift(chat);
      workspace.activeChatId = chat.id;
      work.updatedAt = nowIso();
      await writeDb(db);
      sendJson(res, 201, { chat, activeChatId: chat.id });
      return true;
    }
    const chatId = parts[4];
    const chat = workspace.chats.find((item) => item.id === chatId);
    if (!chat) {
      sendError(res, 404, "Chat not found");
      return true;
    }
    if (req.method === "PATCH" && parts.length === 5) {
      const body = await readBody(req);
      if (Object.hasOwn(body, "title")) {
        chat.title = normalizeText(body.title).slice(0, 36) || "新对话";
      }
      workspace.activeChatId = chat.id;
      chat.updatedAt = nowIso();
      await writeDb(db);
      sendJson(res, 200, { chat, activeChatId: chat.id });
      return true;
    }
    if (req.method === "DELETE" && parts.length === 5) {
      workspace.chats = workspace.chats.filter((item) => item.id !== chat.id);
      if (!workspace.chats.length) {
        workspace.chats.push(createChatRecord());
      }
      workspace.activeChatId = workspace.chats[0].id;
      await writeDb(db);
      sendJson(res, 200, { ok: true, activeChatId: workspace.activeChatId, chats: workspace.chats });
      return true;
    }
    if (req.method === "POST" && parts.length === 7 && parts[5] === "messages" && parts[6] === "stream") {
      const body = await readBody(req);
      const content = String(body.content || "").trim().slice(0, 20000);
      if (!content) {
        sendError(res, 400, "消息不能为空。");
        return true;
      }
      const userMessage = createMessage("user", content, { retryOf: body.retryOf });
      const assistantMessage = createMessage("assistant", "");
      chat.messages.push(userMessage);
      if (chat.title === "新对话" || chat.messages.filter((message) => message.role === "user").length === 1) {
        chat.title = autoChatTitle(content);
      }
      workspace.activeChatId = chat.id;
      chat.updatedAt = nowIso();
      work.updatedAt = chat.updatedAt;
      await writeDb(db);

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      sendSseEvent(res, "meta", { userMessageId: userMessage.id, assistantMessageId: assistantMessage.id, chatTitle: chat.title });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), getAiConfig(false).timeoutMs);
      res.once("close", () => controller.abort());
      let output = "";
      try {
        const result = await callConversationStream(work, chat, (delta) => {
          output += delta;
          sendSseEvent(res, "delta", { text: delta });
        }, controller.signal);
        assistantMessage.content = output || result.text;
        assistantMessage.status = "complete";
        chat.messages.push(assistantMessage);
        chat.updatedAt = nowIso();
        await writeDb(db);
        sendSseEvent(res, "done", { message: assistantMessage, provider: result.provider, warning: result.warning || "" });
      } catch (error) {
        if (output) {
          assistantMessage.content = output;
          assistantMessage.status = "interrupted";
          chat.messages.push(assistantMessage);
          chat.updatedAt = nowIso();
          await writeDb(db);
        }
        sendSseEvent(res, "error", { message: error.name === "AbortError" ? "生成已停止。" : error.message, status: error.name === "AbortError" ? 499 : error.status || 502, retryable: true, partialMessage: output ? assistantMessage : null });
      } finally {
        clearTimeout(timeout);
        if (!res.writableEnded && !res.destroyed) {
          res.end();
        }
      }
      return true;
    }
    if (req.method === "POST" && parts.length === 6 && parts[5] === "proposals") {
      const body = await readBody(req);
      const type = normalizeText(body.type);
      const generated = await generateArtifactFields(work, type, normalizeText(body.instruction));
      const proposal = createArtifactProposal(work, chat.id, type, generated, body.sourceMessageId);
      workspace.proposals.unshift(proposal);
      chat.updatedAt = nowIso();
      work.updatedAt = chat.updatedAt;
      await writeDb(db);
      sendJson(res, 201, { proposal });
      return true;
    }
  }

  if (parts[3] === "proposals" && parts.length >= 5) {
    const workspace = ensureAiWorkspace(work);
    const proposal = workspace.proposals.find((item) => item.id === parts[4]);
    if (!proposal) {
      sendError(res, 404, "Proposal not found");
      return true;
    }
    if (req.method === "POST" && parts.length === 6 && parts[5] === "apply") {
      const body = await readBody(req);
      const appliedKeys = applyArtifactProposal(work, proposal, body.sectionKeys);
      work.updatedAt = nowIso();
      await writeDb(db);
      sendJson(res, 200, { proposal, appliedKeys, storyBible: work.storyBible });
      return true;
    }
    if (req.method === "POST" && parts.length === 6 && parts[5] === "revert") {
      revertArtifactProposal(work, proposal);
      work.updatedAt = nowIso();
      await writeDb(db);
      sendJson(res, 200, { proposal, storyBible: work.storyBible });
      return true;
    }
    if (req.method === "PATCH" && parts.length === 5) {
      proposal.status = "discarded";
      await writeDb(db);
      sendJson(res, 200, { proposal });
      return true;
    }
  }

  return false;
}

async function handleAiApi(req, res, parts) {
  if (req.method === "GET" && parts.length === 3 && parts[2] === "status") {
    const config = publicAiConfig();
    return sendJson(res, 200, {
      configured: config.configured,
      model: config.model,
      baseUrl: config.baseUrl,
      provider: config.statusProvider,
      providerLabel: config.providerLabel,
      endpoint: config.endpoint
    });
  }

  if (req.method === "GET" && parts.length === 3 && parts[2] === "config") {
    return sendJson(res, 200, { config: publicAiConfig() });
  }

  if (req.method === "GET" && parts.length === 3 && parts[2] === "models") {
    return sendJson(res, 200, await listSelectableAiModels());
  }

  if (req.method === "POST" && parts.length === 3 && parts[2] === "config") {
    const body = await readBody(req);
    const config = await saveAiConfig(body);
    return sendJson(res, 200, { config });
  }

  if (req.method === "POST" && parts.length === 3 && parts[2] === "test") {
    const body = await readBody(req);
    const result = await testAiConnection(body.provider);
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && parts.length === 3 && parts[2] === "write") {
    const body = await readBody(req);
    const mode = normalizeText(body.mode) || "continue";
    const continuityModes = new Set(["continue", "polish", "expand", "shorten", "custom"]);
    let result;
    if (continuityModes.has(mode)) {
      await readDb();
      const task = await taskService.create({ ...body, requestId: body.requestId || createId("request") });
      result = await taskService.wait(task.id);
    } else {
      const db = await readDb();
      const work = findWork(db, normalizeText(body.workId || body.work?.id));
      const chapter = work && findChapter(work, normalizeText(body.chapterId || body.chapter?.id));
      if (!work || !chapter) return sendError(res, 404, "作品或章节不存在，请刷新后重试。");
      result = await callOpenAiWriter({ ...body, work, chapter });
    }
    return sendJson(res, 200, result);
  }

  return sendError(res, 404, "AI route not found");
}

async function handleSystemApi(req, res, parts) {
  if (req.method === "POST" && parts.length === 3 && parts[2] === "shutdown") {
    if (process.env.MOTAI_DESKTOP === "1") {
      return sendJson(res, 200, { ok: true, desktop: true });
    }

    sendJson(res, 200, { ok: true, desktop: false });
    fsp.unlink(path.join(ROOT, ".motai.pid")).catch(() => {});
    setTimeout(() => process.exit(0), 250);
    return;
  }

  return sendError(res, 404, "System route not found");
}

async function handleApi(req, res, url) {
  if (await betaApi(req, res, url)) return;
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length === 1 && parts[0] === "api") {
    return sendJson(res, 200, {
      ok: true,
      name: "墨台写作平台",
      version: PACKAGE_VERSION,
      desktop: process.env.MOTAI_DESKTOP === "1"
    });
  }

  if (parts[0] === "api" && parts[1] === "ui-preferences" && parts.length === 2) {
    if (req.method === "GET") {
      return sendJson(res, 200, await readUiPreferences());
    }

    if (req.method === "PATCH") {
      const preferences = await writeUiPreferences(await readBody(req));
      return sendJson(res, 200, { ok: true, preferences });
    }

    return sendError(res, 405, "UI preferences method not allowed");
  }

  if (parts[0] === "api" && parts[1] === "site-art") {
    if (req.method !== "POST" || parts.length !== 2) {
      return sendError(res, 404, "API route not found");
    }

    const body = await readBody(req);
    const result = await callSiteArtGenerator(body.prompt);
    return sendJson(res, 200, {
      image: result.cover,
      prompt: result.coverPrompt,
      model: result.model,
      provider: result.provider
    });
  }

  if (parts[0] === "api" && parts[1] === "wallpapers" && parts.length === 3) {
    const action = parts[2];
    if (req.method !== "POST" || !["upload", "generate"].includes(action)) {
      return sendError(res, 405, "Wallpaper method not allowed");
    }

    const body = await readBody(req, Math.ceil(WALLPAPER_MAX_BYTES * 1.4), "壁纸图片不能超过 25MB。");
    const name = normalizeText(body.name).slice(0, 80) || (action === "generate" ? "AI 生成壁纸" : "自定义壁纸");
    const theme = UI_WALLPAPER_THEMES.has(body.theme) ? body.theme : "";
    const wallpaperWork = action === "generate" && normalizeText(body.workId)
      ? findWork(await readDb(), normalizeText(body.workId))
      : null;
    const image = action === "upload"
      ? await saveWallpaperBuffer(parseUploadedWallpaper(body.image))
      : (await callWallpaperGenerator(body.prompt, theme, wallpaperWork)).image;
    const id = path.basename(image, path.extname(image));

    return sendJson(res, 201, {
      wallpaper: { id, name, image, theme, source: "custom", workId: wallpaperWork?.id || "" },
      ...(action === "generate" ? { source: "ai" } : { source: "upload" })
    });
  }

  if (parts[0] === "api" && parts[1] === "backup") {
    if (req.method === "GET" && parts.length === 3 && parts[2] === "status") {
      return sendJson(res, 200, { automatic: await getAutomaticBackupStatus() });
    }

    if (req.method === "GET" && parts.length === 2) {
      const payload = await buildBackupPayload();
      return sendDownload(res, {
        mime: "application/json; charset=utf-8",
        buffer: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"),
        fileName: `墨台备份-${backupTimestamp()}.motai-backup.json`
      });
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "restore") {
      const body = await readBody(req, BACKUP_MAX_BYTES, "BACKUP_TOO_LARGE");
      const result = await restoreBackupPayload(body);
      return sendJson(res, 200, { ok: true, ...result });
    }

    return sendError(res, 404, "Backup route not found");
  }

  if (parts[0] === "api" && parts[1] === "ai") {
    return handleAiApi(req, res, parts);
  }

  if (parts[0] === "api" && parts[1] === "system") {
    return handleSystemApi(req, res, parts);
  }

  if (parts[0] !== "api" || parts[1] !== "works") {
    return sendError(res, 404, "API route not found");
  }

  const db = await readDb();

  if (req.method === "GET" && parts.length === 2) {
    const works = db.works
      .map(workSummary)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return sendJson(res, 200, { works });
  }

  if (req.method === "POST" && parts.length === 2) {
    const body = await readBody(req);
    const timestamp = nowIso();
    const title = normalizeText(body.title) || "未命名作品";
    const chapterTitle = normalizeText(body.chapterTitle) || "第一章";
    const work = {
      id: createId("work"),
      ownerId: "local",
      title,
      author: normalizeText(body.author).slice(0, 40) || "未署名",
      premise: normalizeText(body.premise),
      genre: normalizeText(body.genre) || "原创",
      status: normalizeText(body.status) || "draft",
      tags: Array.isArray(body.tags) ? body.tags.map(normalizeText).filter(Boolean).slice(0, 8) : [],
      targetCharacters: Number(body.targetCharacters) || 80000,
      boldness: clampNumber(body.boldness, 0, 100, 50),
      storyBible: normalizeStoryBible(body.storyBible),
      coverStyle: normalizeCoverStyle(body.coverStyle),
      coverLogline: normalizeText(body.coverLogline),
      cover: DEFAULT_COVER_PATH,
      coverHistory: [],
      canon: { version: 1, status: "empty", entities: [], facts: [] },
      generationRecords: [],
      canonProposals: [],
      notes: "",
      createdAt: timestamp,
      updatedAt: timestamp,
      chapters: [
        {
          id: createId("chapter"),
          title: chapterTitle,
          content: "",
          richContent: plainTextToRichContent(""),
          contentFormat: "quill-delta-v1",
          notes: "",
          status: "draft",
          planning: normalizeChapterPlanning(body.chapterPlanning),
          chapterMemory: normalizeChapterMemory(),
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      aiWorkspace: normalizeAiWorkspace({ chats: [createChatRecord()] })
    };

    db.works.unshift(work);
    await writeDb(db);
    return sendJson(res, 201, { work });
  }

  const workId = parts[2];
  const work = findWork(db, workId);

  if (!work) {
    return sendError(res, 404, "Work not found");
  }

  if (await handleStudioWorkspaceApi(req, res, parts, db, work)) {
    return;
  }

  if (req.method === "GET" && parts.length === 3) {
    work.boldness = getWorkBoldness(work);
    work.storyBible = normalizeStoryBible(work.storyBible);
    work.coverStyle = normalizeCoverStyle(work.coverStyle);
    work.coverLogline = normalizeText(work.coverLogline);
    work.aiWorkspace = normalizeAiWorkspace(work.aiWorkspace);
    work.canon = upgradeDatabase({ schemaVersion: DATABASE_SCHEMA_VERSION, works: [work] }).db.works[0].canon;
    work.chapters = (work.chapters || []).map((chapter) => ({
      ...chapter,
      planning: normalizeChapterPlanning(chapter.planning),
      richContent: chapter.richContent
        ? normalizeRichContent(chapter.richContent)
        : plainTextToRichContent(chapter.content),
      contentFormat: "quill-delta-v1",
      chapterMemory: normalizeChapterMemory(chapter.chapterMemory)
    }));
    ensureCoverHistory(work);
    return sendJson(res, 200, { work });
  }

  if (req.method === "PATCH" && parts.length === 3) {
    const body = await readBody(req);
    const textFields = ["title", "author", "premise", "genre", "status", "notes"];

    for (const field of textFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        work[field] = normalizeText(body[field]);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "targetCharacters")) {
      work.targetCharacters = Math.max(0, Number(body.targetCharacters) || 0);
    }

    if (Object.prototype.hasOwnProperty.call(body, "boldness")) {
      work.boldness = clampNumber(body.boldness, 0, 100, 50);
    }

    if (Object.prototype.hasOwnProperty.call(body, "storyBible")) {
      work.storyBible = normalizeStoryBible(body.storyBible);
    }

    if (Object.prototype.hasOwnProperty.call(body, "coverStyle")) {
      work.coverStyle = normalizeCoverStyle(body.coverStyle);
    }

    if (Object.prototype.hasOwnProperty.call(body, "coverLogline")) {
      work.coverLogline = normalizeText(body.coverLogline).slice(0, 180);
    }

    if (Array.isArray(body.tags)) {
      work.tags = body.tags.map(normalizeText).filter(Boolean).slice(0, 8);
    }

    work.updatedAt = nowIso();
    await writeDb(db);
    return sendJson(res, 200, { work });
  }

  if (req.method === "DELETE" && parts.length === 3) {
    db.works = db.works.filter((item) => item.id !== work.id);
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && parts.length === 4 && parts[3] === "export") {
    const file = buildWorkExportFile(work, url.searchParams.get("format"));
    if (!file) {
      return sendError(res, 400, "Unsupported export format");
    }
    return sendDownload(res, file);
  }

  if (req.method === "POST" && parts.length === 5 && parts[3] === "story-bible" && parts[4] === "generate") {
    work.boldness = getWorkBoldness(work);
    work.storyBible = normalizeStoryBible(work.storyBible);
    const result = await callStoryBibleGenerator(work);
    work.storyBible = result.storyBible;
    work.updatedAt = nowIso();
    await writeDb(db);
    return sendJson(res, 200, {
      work,
      storyBible: work.storyBible,
      quality: assessStoryBibleQuality(work, work.storyBible),
      fallback: Boolean(result.fallback),
      warning: result.warning || "",
      model: result.model || ""
    });
  }

  if (req.method === "POST" && parts.length === 5 && parts[3] === "story-bible" && parts[4] === "check") {
    return sendJson(res, 200, { quality: assessStoryBibleQuality(work, work.storyBible) });
  }

  if (req.method === "POST" && parts.length === 5 && parts[3] === "cover" && parts[4] === "generate") {
    const body = await readBody(req);
    work.boldness = getWorkBoldness(work);
    work.storyBible = normalizeStoryBible(work.storyBible);
    const prompt = normalizeText(body.prompt);
    const result = await callImageGenerator(work, prompt);
    recordCoverHistory(work, await createTypographicCover(work, result.cover) || DEFAULT_COVER_PATH, {
      source: "ai",
      prompt: result.coverPrompt || prompt
    });
    work.coverPrompt = result.coverPrompt;
    work.updatedAt = nowIso();
    await writeDb(db);
    return sendJson(res, 200, {
      work,
      cover: work.cover,
      coverPrompt: work.coverPrompt,
      model: result.model,
      provider: result.provider,
      fallback: Boolean(result.fallback),
      warning: result.warning || ""
    });
  }

  if (req.method === "POST" && parts.length === 5 && parts[3] === "cover" && parts[4] === "upload") {
    const body = await readBody(req, Math.ceil(COVER_MAX_BYTES * 1.4), "封面图片不能超过 25MB。");
    recordCoverHistory(work, await createTypographicCover(work, body.image), {
      source: "upload",
      prompt: "本地上传"
    });
    work.updatedAt = nowIso();
    await writeDb(db);
    return sendJson(res, 200, { work, cover: work.cover, source: "upload" });
  }

  if (req.method === "POST" && parts.length === 5 && parts[3] === "cover" && parts[4] === "select") {
    const body = await readBody(req);
    const history = ensureCoverHistory(work);
    const selectedId = normalizeText(body.historyId);
    const selected = history.find((item) => item.id === selectedId);
    if (!selected) {
      return sendError(res, 404, "未找到该封面历史记录");
    }
    work.cover = selected.cover;
    work.updatedAt = nowIso();
    await writeDb(db);
    return sendJson(res, 200, { work, cover: work.cover, selected });
  }

  if (req.method === "POST" && parts.length === 5 && parts[3] === "cover" && parts[4] === "rebuild") {
    const currentCoverName = localCoverFileName(work.cover);
    if (!currentCoverName) {
      return sendError(res, 400, "当前封面不是可重新排版的本地图片，请先生成或上传封面。" );
    }
    const sourceBuffer = await fsp.readFile(path.join(COVER_DIR, currentCoverName));
    const sourceExtension = path.extname(currentCoverName).toLowerCase();
    const sourceMime = imageMimeForExtension(sourceExtension);
    let imageValue = `data:${sourceMime};base64,${sourceBuffer.toString("base64")}`;
    if (sourceExtension === ".svg") {
      const embedded = sourceBuffer.toString("utf8").match(/<image\s+[^>]*href="(data:[^"]+)"/iu);
      if (!embedded) {
        return sendError(res, 422, "当前封面缺少可重新排版的背景图，请重新生成或上传封面。" );
      }
      imageValue = embedded[1];
    }
    recordCoverHistory(work, await createTypographicCover(work, imageValue), {
      source: "layout",
      prompt: "更新封面信息排版"
    });
    work.updatedAt = nowIso();
    await writeDb(db);
    return sendJson(res, 200, { work, cover: work.cover, source: "layout" });
  }

  if (req.method === "POST" && parts.length === 6 && parts[3] === "canon-proposals" && ["confirm", "reject"].includes(parts[5])) {
    const body = await readBody(req);
    const proposalId = parts[4];
    const action = parts[5];
    const result = await dataStore.transact((stored) => {
      const upgraded = upgradeDatabase(stored).db;
      Object.assign(stored, upgraded);
      const storedWork = findWork(stored, work.id);
      const proposal = storedWork?.canonProposals.find((item) => item.id === proposalId);
      if (!proposal) {
        const error = new Error("事实提案不存在。");
        error.status = 404;
        throw error;
      }
      if (proposal.status !== "pending") {
        const error = new Error("这份事实提案已经处理，不能重复操作。");
        error.status = 409;
        throw error;
      }
      const sourceGeneration = storedWork.generationRecords.find((item) => item.id === proposal.generationRecordId);
      const sourceChapter = storedWork.chapters.find(c => c.id === proposal.chapterId);
      const directReview = !proposal.generationRecordId && proposal.sourceRevision === sourceChapter?.revision;
      if (!directReview && (!sourceGeneration || sourceGeneration.status !== "accepted")) {
        const error = new Error("请先接受对应正文，再确认或拒绝事实更新。");
        error.status = 409;
        throw error;
      }
      const decidedAt = nowIso();
      if (action === "reject") {
        proposal.status = "rejected";
        proposal.decidedAt = decidedAt;
      } else {
        const selected = new Set(Array.isArray(body.factIds) ? body.factIds.map(normalizeText) : []);
        const filtered = { ...proposal, changes: proposal.changes.filter((change) => change.fact?.id && selected.has(change.fact.id)) };
        if (filtered.changes.length) {
          const applied = applyCanonProposal(storedWork.canon, filtered, { decidedAt });
          storedWork.canon = applied.canon;
          Object.assign(proposal, applied.proposal);
        } else {
          proposal.status = "accepted";
          proposal.decidedAt = decidedAt;
        }
      }
      storedWork.updatedAt = decidedAt;
      return { proposal, canon: storedWork.canon };
    });
    return sendJson(res, 200, result);
  }

  if (parts[3] !== "chapters") {
    return sendError(res, 404, "API route not found");
  }

  if (req.method === "POST" && parts.length === 4) {
    const body = await readBody(req);
    const timestamp = nowIso();
    const chapter = {
      id: createId("chapter"),
      title: normalizeText(body.title) || `第${(work.chapters || []).length + 1}章`,
      content: "",
      richContent: plainTextToRichContent(""),
      contentFormat: "quill-delta-v1",
      notes: "",
      status: "draft",
      planning: normalizeChapterPlanning(body.planning),
      chapterMemory: normalizeChapterMemory(),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    work.chapters = Array.isArray(work.chapters) ? work.chapters : [];
    work.chapters.push(chapter);
    work.updatedAt = timestamp;
    await writeDb(db);
    return sendJson(res, 201, { chapter, work });
  }

  const chapterId = parts[4];
  const chapter = findChapter(work, chapterId);

  if (!chapter) {
    return sendError(res, 404, "Chapter not found");
  }

  if (req.method === "POST" && parts.length === 8 && parts[5] === "generations" && parts[7] === "accept") {
    const body = await readBody(req, 2 * 1024 * 1024, "章节内容过大，无法写入。");
    const generationId = parts[6];
    const result = await dataStore.transact((stored) => {
      const upgraded = upgradeDatabase(stored).db;
      Object.assign(stored, upgraded);
      const storedWork = findWork(stored, work.id);
      const storedChapter = storedWork && findChapter(storedWork, chapter.id);
      const record = storedWork?.generationRecords.find((item) => item.id === generationId);
      if (!storedChapter || !record || record.chapterId !== storedChapter.id) {
        const error = new Error("生成记录或章节不存在，请重新生成。");
        error.status = 404;
        throw error;
      }
      if (body.baseChapterUpdatedAt && body.baseChapterUpdatedAt !== storedChapter.updatedAt) {
        const error = new Error("章节已更新，不能写入基于旧版本生成的内容。");
        error.status = 409;
        throw error;
      }
      if (hashChapterContent(storedChapter) !== record.baseContentHash) {
        const error = new Error("章节正文已变化，不能写入基于旧正文生成的内容。");
        error.status = 409;
        throw error;
      }
      if (!canAcceptGeneration(record)) {
        const error = new Error("生成结果仍有未解决的硬冲突，不能写入正文。请先重新生成或修改指令。");
        error.status = 409;
        throw error;
      }
      const richContent = normalizeRichContent(body.richContent);
      const content = richContentToMarkdown(richContent);
      const generated = selectedGenerationOutput(record);
      const comparable = (value) => String(value || "").replace(/\s+/g, "");
      if (!generated || !comparable(content).includes(comparable(generated))) {
        const error = new Error("待写入正文中没有找到本次 AI 生成内容，已阻止错误写入。");
        error.status = 400;
        throw error;
      }
      const acceptedAt = nowIso();
      storedChapter.richContent = richContent;
      storedChapter.content = content;
      storedChapter.contentFormat = "quill-delta-v1";
      storedChapter.updatedAt = acceptedAt;
      record.status = "accepted";
      record.acceptedAt = acceptedAt;
      const proposal = storedWork.canonProposals.find((item) => item.generationRecordId === record.id && item.status === "pending") || null;
      if (proposal) {
        storedChapter.chapterMemory = normalizeChapterMemory({
          ...proposal.chapterMemory,
          status: "confirmed",
          sourceContentHash: hashChapterContent(content),
          updatedAt: acceptedAt
        });
      }
      storedWork.updatedAt = acceptedAt;
      return { chapter: storedChapter, work: storedWork, generation: record, canonProposal: proposal?.changes?.length ? proposal : null };
    });
    scheduleAutomaticBackup();
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && parts.length === 7 && parts[5] === "images" && ["generate", "upload"].includes(parts[6])) {
    const action = parts[6];
    const body = await readBody(req, Math.ceil(COVER_MAX_BYTES * 1.4), "章节插图不能超过 25MB。");
    let imagePath = "";
    let source = "upload";
    let prompt = "";
    let model = "";

    if (action === "upload") {
      imagePath = await saveIllustrationBuffer(work.id, chapter.id, parseUploadedIllustration(body.image));
    } else {
      work.boldness = getWorkBoldness(work);
      work.storyBible = normalizeStoryBible(work.storyBible);
      const result = await callChapterIllustrationGenerator(work, chapter, body.prompt);
      imagePath = result.image;
      source = "ai";
      prompt = result.prompt;
      model = result.model;
    }

    const caption = normalizeText(body.caption).slice(0, 120) || chapter.title || "章节插图";
    const markdown = `![${caption}](${imagePath})`;
    return sendJson(res, 201, { image: imagePath, caption, markdown, source, prompt, model });
  }

  if (req.method === "PATCH" && parts.length === 5) {
    const body = await readBody(req);
    const textFields = ["title", "content", "notes", "status"];

    for (const field of textFields) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        chapter[field] = field === "content" ? String(body[field] || "") : normalizeText(body[field]);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "richContent")) {
      chapter.richContent = normalizeRichContent(body.richContent);
      chapter.contentFormat = "quill-delta-v1";
      chapter.content = richContentToMarkdown(chapter.richContent);
    } else if (Object.prototype.hasOwnProperty.call(body, "content")) {
      chapter.richContent = plainTextToRichContent(chapter.content);
      chapter.contentFormat = "quill-delta-v1";
    }

    if (Object.prototype.hasOwnProperty.call(body, "planning")) {
      chapter.planning = normalizeChapterPlanning(body.planning);
    }

    const timestamp = nowIso();
    chapter.updatedAt = timestamp;
    work.updatedAt = timestamp;
    await writeDb(db);
    return sendJson(res, 200, { chapter, work });
  }

  if (req.method === "DELETE" && parts.length === 5) {
    work.chapters = work.chapters.filter((item) => item.id !== chapter.id);
    work.updatedAt = nowIso();
    await writeDb(db);
    return sendJson(res, 200, { ok: true, work });
  }

  return sendError(res, 405, "Method not allowed");
}

function isPathInside(root, filePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(filePath);
  return resolvedFile === resolvedRoot || resolvedFile.startsWith(`${resolvedRoot}${path.sep}`);
}

async function serveStatic(req, res, url) {
  let resolved = "";
  let allowDirectoryIndex = true;

  try {
    if (url.pathname === "/vendor/quill/quill.js") {
      resolved = require.resolve("quill/dist/quill.js");
      allowDirectoryIndex = false;
    } else if (url.pathname === "/vendor/quill/quill.snow.css") {
      resolved = require.resolve("quill/dist/quill.snow.css");
      allowDirectoryIndex = false;
    } else if (url.pathname.startsWith(`${COVER_URL_PREFIX}/`)) {
      const relativePath = decodeURIComponent(url.pathname.slice(COVER_URL_PREFIX.length + 1));
      resolved = path.resolve(COVER_DIR, relativePath);
      allowDirectoryIndex = false;

      if (!isPathInside(COVER_DIR, resolved)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
    } else if (url.pathname.startsWith(`${WALLPAPER_URL_PREFIX}/`)) {
      const relativePath = decodeURIComponent(url.pathname.slice(WALLPAPER_URL_PREFIX.length + 1));
      resolved = path.resolve(WALLPAPER_DIR, relativePath);
      allowDirectoryIndex = false;

      if (!isPathInside(WALLPAPER_DIR, resolved)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
    } else {
      const relativePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      resolved = path.resolve(PUBLIC_DIR, relativePath);

      if (!isPathInside(PUBLIC_DIR, resolved)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
    }
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }

  if (!resolved) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const stat = await fsp.stat(resolved);
    if (stat.isDirectory() && !allowDirectoryIndex) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }

    const filePath = stat.isDirectory() ? path.join(resolved, "index.html") : resolved;
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const SUPER_SEMINARY_KEYWORDS = [
  "超神学院", "雄兵连", "葛小伦", "银河之力", "卢小鱼", "系统", "魂穿", "开挂",
  "死神卡尔", "卡尔", "虚空", "天使文明", "恶魔", "饕餮", "地球", "巨峡号",
  "杜卡奥", "蔷薇", "蕾娜", "彦", "凯莎", "莫甘娜", "战力成长", "反虚空"
];

function getStoryGenerationIdentity(work) {
  return [
    work?.title,
    work?.genre,
    Array.isArray(work?.tags) ? work.tags.join(" ") : work?.tags,
    work?.premise
  ].map((value) => normalizeText(value)).filter(Boolean).join("\n");
}

function isSuperSeminarySystemFanfic(work) {
  return SUPER_SEMINARY_KEYWORDS.some((keyword) => getStoryGenerationIdentity(work).includes(keyword));
}

function isFanficWork(work) {
  return /同人|衍生/.test(String(work?.genre || "")) || isSuperSeminarySystemFanfic(work);
}

function isMemoryLossRomance(work) {
  const identity = getStoryGenerationIdentity(work);
  const memorySignals = /(失忆|失去.{0,8}记忆|遗忘|忘记|忘了|想起|记忆恢复)/.test(identity);
  const romanceSignals = /(纯爱|恋爱|恋人|前任|喜欢|爱过|重逢|暧昧|都市|情感)/.test(identity);
  return memorySignals && romanceSignals;
}

function isSyntheticPersonSpaceStory(work) {
  const identity = getStoryGenerationIdentity(work);
  const syntheticSignals = /(仿生人|合成人|机器人|人工智能|人造人|人格|意识备份)/.test(identity);
  const spaceSignals = /(银河|星际|宇宙|星港|航线|赏金猎人|飞船|文明|销毁|追捕)/.test(identity);
  return syntheticSignals && spaceSignals;
}

function extractTopicKeywords(work) {
  const identity = getStoryGenerationIdentity(work);
  return SUPER_SEMINARY_KEYWORDS.filter((keyword) => identity.includes(keyword));
}

function getCanonPolicy(work) {
  if (isSuperSeminarySystemFanfic(work)) {
    return [
      "原作优先策略：这是《超神学院/雄兵连》同人系统流。",
      "必须围绕葛小伦/银河之力身份、卢小鱼魂穿、系统任务、雄兵连训练、地球危机、饕餮入侵、天使与恶魔、卡尔与虚空压力展开。",
      "系统可以让主角提前成长，但不能开局无脑碾压所有势力；爽点要来自阶段性成长、信息差、战术选择和改变原作节点后的连锁后果。",
      "可以引用用户已点名的原作角色和势力，但不要照搬原作台词或大段剧情。新剧情要服务于主角改变原作命运这条线。"
    ].join("\n");
  }

  if (isFanficWork(work)) {
    return [
      "原作优先策略：这是同人/衍生作品。",
      "优先识别并尊重标题、简介中出现的原作世界、角色、组织、战力体系、时间线和核心矛盾。",
      "新增主角、系统或金手指必须服务原作矛盾，不能生成与题材无关的通用悬疑模板。"
    ].join("\n");
  }

  return "原创策略：严格围绕作者标题、类型、梗概和备注展开，必须生成可推动后续章节的角色目标、反派压力、阶段剧情和章纲。";
}

function getStoryGenrePolicy(work) {
  if (!isMemoryLossRomance(work)) {
    return getCanonPolicy(work);
  }

  return [
    "都市失忆重逢情感策略：这是以失忆、旧恋人重逢、隐瞒关系和记忆回归为核心的都市情感故事。",
    "世界观应落在可信的城市生活、事故后恢复、工作圈/朋友群与共同旧地，不要硬塞系统、战斗、势力战争或超自然规则。",
    "主线要分成：重逢后的陌生感 -> 再次靠近 -> 旧事和重大事件的线索浮现 -> 男主重新爱上女主 -> 记忆回归与真相爆发 -> 两人共同决定是否重来。",
    "冲突来自信息不对称、女主的隐瞒、男主对被安排人生的抗拒、重大事件留下的责任或伤害，而不是凭空出现的反派。",
    "人物关系必须写成明确的两人关系和箭头方向，至少包含男女主、共同好友、旧事知情人四个可区分角色；用户没有给姓名时，要为主要角色创造自然、易记、符合当代都市题材的中文姓名，禁止最终只写“男主/女主/共同好友”等角色占位名。"
  ].join("\n");
}

function formatChapterPlanLine(index, title, goal, growth, payoff, conflict, hook) {
  return `第${index}章｜${title}｜剧情目标：${goal}｜成长点：${growth}｜爽点：${payoff}｜冲突：${conflict}｜结尾钩子：${hook}`;
}

function findRelevantChapterPlan(chapterPlan, chapterTitle) {
  const title = normalizeText(chapterTitle);
  const lines = String(chapterPlan || "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return "";
  }

  if (title) {
    const normalizedTitle = title.replace(/\s+/g, "");
    const direct = lines.find((line) => line.replace(/\s+/g, "").includes(normalizedTitle));
    if (direct) {
      return direct;
    }

    const numberMatch = normalizedTitle.match(/第([一二三四五六七八九十百千万\d]+)[章节卷]/);
    if (numberMatch) {
      const token = numberMatch[1];
      const byNumber = lines.find((line) => line.includes(`第${token}章`) || line.startsWith(`${token}.`) || line.startsWith(`${token}、`));
      if (byNumber) {
        return byNumber;
      }
    }
  }

  return lines[0];
}

function compactStoryBible(storyBible) {
  const bible = normalizeStoryBible(storyBible);
  if (isStoryBibleEmpty(bible)) {
    return "";
  }

  return [
    bible.logline && `- 卖点：${bible.logline}`,
    bible.theme && `- 主题：${bible.theme}`,
    bible.tone && `- 基调：${bible.tone}`,
    bible.genrePositioning && `- 类型定位：${bible.genrePositioning}`,
    bible.worldview && `- 世界观：${limitText(bible.worldview, 900)}`,
    bible.rules && `- 规则/力量体系：${limitText(bible.rules, 800)}`,
    bible.characters && `- 人物：${limitText(bible.characters, 1100)}`,
    bible.relationships && `- 关系网：${limitText(bible.relationships, 700)}`,
    bible.factions && `- 势力/组织：${limitText(bible.factions, 700)}`,
    bible.locations && `- 关键地点：${limitText(bible.locations, 500)}`,
    bible.conflict && `- 主线冲突：${limitText(bible.conflict, 700)}`,
    bible.antagonistPressure && `- 反派压力：${limitText(bible.antagonistPressure, 500)}`,
    bible.keyEvents && `- 关键事件：${limitText(bible.keyEvents, 900)}`,
    bible.foreshadowing && `- 伏笔：${limitText(bible.foreshadowing, 500)}`,
    bible.outline && `- 故事大纲：${limitText(bible.outline, 1200)}`,
    bible.chapterPlan && `- 章节规划：${limitText(bible.chapterPlan, 1500)}`,
    bible.continuityNotes && `- 连续性提醒：${limitText(bible.continuityNotes, 700)}`
  ].filter(Boolean).join("\n");
}

function buildStoryBiblePrompt(work) {
  const boldness = getWorkBoldness(work);
  const keywords = extractTopicKeywords(work);
  const genrePolicy = getStoryGenrePolicy(work);
  return [
    "你是中文网文长篇策划编辑，不是简介扩写工具。你的任务是把作者的一句话简介拆成可执行的故事圣经、分卷主线和章节推进表。",
    "你擅长把不同题材拆成可写作的角色目标、人物关系、事件因果、阶段矛盾、伏笔回收和10-12章详细章纲。",
    "",
    "作品输入：",
    `- 标题：${work.title || "未命名作品"}`,
    `- 类型：${work.genre || "原创"}`,
    `- 标签：${Array.isArray(work.tags) ? work.tags.join("、") : ""}`,
    `- 简短描述：${work.premise || "暂无"}`,
    `- 大胆程度：${boldness}/100，${getBoldnessLabel(boldness)}`,
    `- 已识别关键词：${keywords.length ? keywords.join("、") : "无"}`,
    "",
    genrePolicy,
    "",
    "硬性质量要求：",
    "0. 每次重新生成设定库，都必须重新阅读并理解上方“一句话梗概”，然后按该梗概生成世界观、人物、势力、系统规则、大纲和章节规划。",
    "1. 禁止把作者简介简单换句话说。每个字段都必须新增可写作的具体信息。",
    "2. 必须写出后续剧情推进：阶段目标、主要阻力、关键事件、反转、代价、伏笔回收。只有作品确有力量体系时才写升级路线和战斗。",
    "3. 同人作品必须主动关联原作世界、原作势力、原作矛盾和原作战力体系；都市情感、悬疑、历史等原创题材则必须遵循自身现实逻辑，不能套用系统流或通用悬疑模板。",
    "4. 只有系统流作品才写清系统来源、任务、奖励、限制与失败代价；非系统作品要把这一栏替换成题材真实有效的约束，例如失忆边界、职业规则、家族压力、案件证据或历史制度。",
    "5. 人物设定至少给出 4 个可区分角色，每人写清身份、表面目标、隐藏动机/秘密、与主角的关系和成长变化。人物字段每行固定为“姓名或角色名：身份｜目标｜秘密/弱点｜成长弧”。",
    "5.1 关系网至少给出 4 条明确关系，每行固定为“甲 -> 乙：关系名称｜当前状态｜主要矛盾或牵引”。甲乙必须与人物字段中的名字完全一致，便于生成箭头图。",
    "6. 大纲必须至少分 5 个阶段，每阶段要说明剧情目标、主角成长、敌方压力和结尾转折。",
    "7. 章节规划必须给 10 到 12 章，每章固定格式：第X章｜标题｜剧情目标：...｜成长点：...｜爽点：...｜冲突：...｜结尾钩子：...",
    "8. 章节规划要能直接指导右侧 AI 写正文，不能只写“异常出现、第一次追查、盟友登场”这种泛用词。",
    "9. 大胆程度只影响创意、反转和爽点强度，不允许脱离用户给定主题或同人原作核心。",
    "10. 世界观、规则、势力/组织和地点必须用当前题材可感知的具体舞台，不允许写“明面组织、暗线势力、成长地点”这种空泛占位词。",
    "11. 不要生成完整正文。",
    "",
    "只输出 JSON，不要 Markdown，不要解释。JSON 字段必须完全如下：",
    JSON.stringify(emptyStoryBible(), null, 2)
  ].join("\n");
}

function buildSuperSeminaryStoryBible(work, reason = "") {
  const title = work.title || "超神学院之我是葛小伦";
  const genre = work.genre || "同人";
  const boldness = getWorkBoldness(work);
  const highBoldness = boldness >= 71;
  const chapterPlan = [
    formatChapterPlanLine(1, "我叫葛小伦！！！", "卢小鱼车祸醒来，确认自己魂穿葛小伦，系统激活并给出第一条主线任务。", "确认银河之力身体素质，获得新手奖励：基础体能修正和战斗直觉。", "用普通人的吐槽视角面对超神世界，第一次感受到身体远超常人的力量。", "他既想苟住，又必须应付葛小伦原本生活和系统限时任务。", "系统提示：三天内接触超神学院，否则主线锁死。"),
    formatChapterPlanLine(2, "系统不是许愿机", "主角测试系统能力，发现奖励必须通过训练、战斗和改变关键节点获得。", "解锁训练面板、银河之力初级解析、剧情节点提醒。", "提前避开原作尴尬局面，表现出比原葛小伦更冷静的一面。", "系统任务诱人，但失败会扣除成长进度并引来更高关注。", "杜卡奥一方检测到葛小伦数据异常。"),
    formatChapterPlanLine(3, "雄兵连征召", "主角正式接触超神学院，被带入雄兵连体系。", "获得基础格斗训练加速和暗能量感知入门。", "与赵信、刘闯、琪琳、蕾娜等人初次碰撞，制造轻松但有张力的队友戏。", "他知道部分剧情却无法解释来源，越解释越可疑。", "蔷薇或蕾娜发现他对未来事件反应异常。"),
    formatChapterPlanLine(4, "训练场上的银河之力", "通过训练证明葛小伦不只是抗揍肉盾。", "体质、抗击打、战场判断和反虚空潜质初步提升。", "主角用系统训练法打出超出预期的表现，让教官和队友改观。", "蕾娜加码训练，主角差点暴露系统对数据的修正。", "系统提示：真正的能力解锁需要实战压力。"),
    formatChapterPlanLine(5, "饕餮警报", "外星威胁提前出现，主角利用剧情记忆提醒队伍并改变局部战局。", "解锁战场预判或短时爆发。", "主角在小规模冲突中救下队友，第一次打出银河之力的压迫感。", "提前干预导致敌方战术改变，原作记忆不再完全可靠。", "卡尔数据库记录到银河之力异常变量。"),
    formatChapterPlanLine(6, "巨峡号上的试探", "杜卡奥和怜风开始调查主角异常成长，队友也察觉他藏着秘密。", "系统开启隐藏任务：获得雄兵连信任。", "主角用半真半假的解释稳住局面，同时提出更有效的训练建议。", "信任危机出现，他必须在隐瞒系统和保护队友之间取舍。", "天使文明捕捉到银河之力成长曲线异常。"),
    formatChapterPlanLine(7, "天使的目光", "天使线索登场，主角意识到宇宙级势力开始关注自己。", "初步理解银河之力未来上限和反虚空方向。", "主角面对高位文明仍敢谈条件，展现穿越者信息差。", "天使秩序与地球立场产生冲突，他不能完全依赖任何阵营。", "系统出现与虚空有关的乱码提示。"),
    formatChapterPlanLine(8, "卡尔的影子", "卡尔不直接现身，而是通过饕餮或虚空实验向主角施压。", "反虚空能力第一次被迫触发。", "主角在绝境中打出超规格反击，证明自己不再只是剧情旁观者。", "能力失控或代价暴露，队友受伤，系统也无法完全解释异常。", "主角确认自己已经改变原作时间线。"),
    formatChapterPlanLine(9, "雄兵连不能输", "团队战爆发，主角必须带动队友成长，而不是独自开挂解决一切。", "解锁团队协同模块或银河之力新战术。", "雄兵连配合打出逆风翻盘，主角成为队伍真正核心之一。", "单人强大无法解决整场战争，主角必须学会信任队友。", "虚空侧准备针对银河之力的新方案。"),
    formatChapterPlanLine(10, "拳打虚空的第一步", "第一卷收束，主角立下对抗卡尔与虚空的长期目标。", "完成阶段进化，明确下一阶段能力方向。", "用一次漂亮反击宣告新葛小伦路线。", "胜利只是局部，真正敌人仍在幕后。", "系统发布长期主线：改写银河之力命运。"),
    formatChapterPlanLine(11, "被改写的未来", "主角发现自己救下的人、提前打出的战果，正在引发新的未来分支。", "获得命运偏移感知，可以识别被改变的重要节点。", "用已知剧情和新情报反向布局，让敌人误判。", "越改变剧情，越不能依赖原作记忆。", "卡尔开始把他视为必须捕获的实验样本。"),
    formatChapterPlanLine(12, "银河之力的新答案", "主角整合系统、雄兵连训练和自身判断，形成第一套属于自己的战斗路线。", "反虚空雏形稳定，系统开放第二阶段任务树。", "主角不再只是魂穿者，而是真正接住葛小伦身份的责任。", "他必须决定是否向最信任的队友透露部分真相。", "第二卷目标出现：阻止虚空实验提前降临地球。")
  ].join("\n");

  return {
    storyBible: {
      logline: `${title}：卢小鱼车祸后魂穿葛小伦，绑定系统，在雄兵连训练、饕餮入侵、天使恶魔博弈、卡尔与虚空逼近的压力下，把“银河之力”从被动成长改写成主动破局的战斗核心。`,
      theme: "一个知道剧情的普通人突然拥有神级身份后，如何在开挂诱惑、原作命运和守护地球之间做出自己的选择。",
      tone: highBoldness
        ? "热血系统流爽文，节奏快、反转强、战斗升级明显，但每次开挂都要伴随代价、敌方升级或未来偏移。"
        : "热血成长、轻松吐槽、团队羁绊和战斗爽点并重，贴合雄兵连初期训练与地球危机节奏。",
      genrePositioning: `${genre}｜超神学院同人｜魂穿葛小伦｜系统流成长｜雄兵连热血爽文`,
      worldview: [
        "背景建立在《超神学院/雄兵连》的地球与宇宙文明冲突上：德诺遗产、超级基因、雄兵连训练、饕餮入侵、天使与恶魔对立、卡尔研究虚空。",
        "卢小鱼魂穿到葛小伦身上后，既继承银河之力这个未来上限极高的身份，又因系统获得提前理解宇宙局势、训练能力和改变关键节点的机会。",
        "主角最大的优势不是单纯数值开挂，而是原作信息差、系统阶段任务、对葛小伦身体潜力的主动开发，以及愿意提前承担责任。"
      ].join("\n"),
      rules: [
        "系统规则：奖励来自训练、战斗、保护队友、改变关键节点和完成主线任务；不能凭空许愿，也不能替主角直接战斗。",
        "失败代价：任务失败会扣除成长进度、暴露系统痕迹，或让敌方更早注意到银河之力异常。",
        "战力成长线：体质觉醒 -> 战场预判 -> 暗能量感知 -> 反虚空雏形 -> 团队协同 -> 银河之力路线重塑。",
        "原作约束：雄兵连、天使、恶魔、卡尔、虚空等高层势力必须保留压迫感，主角不能开局碾压宇宙级存在。",
        "爽点规则：每个爽点都要对应训练成果、战术选择、剧情信息差或关键代价。"
      ].join("\n"),
      era: "现代地球进入宇宙文明冲突前夜，从雄兵连组建初期推进到饕餮入侵、天使关注、卡尔与虚空压力提前浮现。",
      characters: [
        "卢小鱼/葛小伦：灵魂来自现实世界，熟悉《超神学院》部分剧情。外在身份是葛小伦，内在目标先是活下去，再是保护地球和改写原本被动成长的命运。弱点是前期心态仍是普通人，容易依赖剧情记忆；成长弧是从“知道剧情的穿越者”变成真正承担银河之力责任的人。",
        "系统：绑定主角，提供任务、训练加速、能力解析和阶段奖励。系统不替主角战斗，只放大他的努力、判断和关键选择。后期可埋下系统来源与虚空/银河之力异常的谜团。",
        "雄兵连队友：赵信、刘闯、琪琳、蕾娜、蔷薇等既是伙伴也是主角成长压力。主角提前表现会改变队友对葛小伦的认知，也会影响队伍原本的成长节奏。",
        "杜卡奥/超神学院：观察葛小伦异常成长，既想培养他，也会警惕无法解释的系统痕迹。",
        "卡尔/虚空势力：远期主要压力。主角的异常成长会提前进入卡尔视野，使他从原作角色变成“银河之力异常样本”。",
        "天使与恶魔：天使关注银河之力潜力和秩序选择；恶魔利用地球混乱试探主角底线。"
      ].join("\n"),
      relationships: [
        "卢小鱼/葛小伦 -> 蔷薇：队友与互相试探｜保留原作张力但不强行推进｜矛盾：主角的异常预知会让蔷薇提高警惕。",
        "卢小鱼/葛小伦 -> 蕾娜：教官与战场伙伴｜训练压迫逐步转为战场互信｜矛盾：蕾娜会追问他异常成长的来源。",
        "卢小鱼/葛小伦 -> 雄兵连队友：队友与共同成长者｜从插科打诨走向并肩作战｜矛盾：主角过早变强可能打乱队友节奏。",
        "卢小鱼/葛小伦 -> 杜卡奥：被培养者与观察对象｜杜卡奥愿意投入资源也会保持警惕｜矛盾：系统痕迹无法用常规解释。",
        "卢小鱼/葛小伦 -> 卡尔：异常变量与虚空研究者｜远程博弈逐步升级｜矛盾：主角的成长会提前进入卡尔视野。",
        "卢小鱼/葛小伦 -> 系统：宿主与协作规则｜系统提供任务但不替主角战斗｜矛盾：主角必须追问系统来源与真实目的。"
      ].join("\n"),
      factions: "雄兵连/超神学院：地球超级战士核心；饕餮：早期入侵压力；天使文明：秩序与正义立场；恶魔文明：混乱与诱惑；卡尔与冥河：虚空研究和终极威胁；系统：只绑定主角，来源未知，后续可与银河之力或虚空异常有关。",
      locations: "葛小伦日常生活起点、超神学院训练基地、巨峡号、第一次饕餮冲突战场、天使降临地点、冥河/虚空线索相关战场。",
      conflict: "主线冲突是卢小鱼想利用系统改写原作命运，却必须面对蝴蝶效应：敌人更早注意他，队友可能因他过强而成长不足，杜卡奥会怀疑他，卡尔会把他当成研究虚空与银河之力的异常样本。",
      antagonistPressure: highBoldness
        ? "卡尔提前投放虚空试探，饕餮战术升级，恶魔试图诱导主角暴露系统；主角越开挂，越会引来更高层级的关注。"
        : "饕餮入侵、雄兵连训练压力、杜卡奥观察、卡尔远程布局逐步叠加，让主角不能只靠熟知剧情躺赢。",
      foreshadowing: "系统任务偶尔出现无法解释的乱码；葛小伦原本身体记忆与卢小鱼意识冲突；卡尔数据库出现“银河之力异常波动”；天使提前察觉主角反虚空能力成长速度异常；主角每次改变剧情都会导致新的未知节点出现。",
      continuityNotes: "AI 写作必须围绕卢小鱼魂穿葛小伦、系统流成长、雄兵连训练、地球危机、卡尔与虚空压力推进。不要写成通用悬疑、旧档案调查或普通都市异能。主角可以爽，但每次爽点要对应训练、系统任务、战斗代价或剧情信息差。",
      outline: [
        "第一阶段：魂穿与系统激活。卢小鱼确认自己成为葛小伦，获得系统，但系统规则限制他不能无脑许愿。他要先稳住身份，并准备接触超神学院。",
        "第二阶段：进入雄兵连。主角在训练中主动开发银河之力，利用原作信息差改变自己和队友的成长节奏，同时引起杜卡奥、怜风等人的观察。",
        "第三阶段：第一次外星冲突。饕餮威胁出现，主角用剧情记忆和系统奖励改变局部战局，获得队友认可，也让敌方提前记录银河之力异常。",
        "第四阶段：宇宙势力关注。天使、恶魔、卡尔线索逐步出现，主角发现熟知剧情不等于掌控未来，越改变越会制造未知风险。",
        "第五阶段：虚空压力逼近。卡尔把主角视为异常变量，开始试探银河之力与系统关系。主角必须把系统奖励、银河之力和雄兵连羁绊整合成真正战力。",
        "第六阶段：改写命运。主角从利用原作剧情转向主动创造新路线，目标从活下去升级为保护地球、带动雄兵连成长、阻止虚空实验提前降临。"
      ].join("\n"),
      chapterPlan
    },
    fallback: true,
    warning: reason || "已使用超神学院同人系统流本地模板生成设定库。"
  };
}

function stableTextHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickStableName(work, names, salt) {
  const source = `${getStoryGenerationIdentity(work)}|${salt}`;
  return names[stableTextHash(source) % names.length];
}

function buildMemoryLossRomanceCast(work) {
  return {
    male: pickStableName(work, ["沈知言", "周叙白", "陆沉舟", "陈屿", "江予安", "贺闻川", "顾言川", "宋远"], "male"),
    female: pickStableName(work, ["林晚", "苏念", "许知夏", "程安然", "姜晚宁", "沈栀", "叶知微", "温宁"], "female"),
    friend: pickStableName(work, ["周予安", "顾念", "乔宁", "陆时安", "唐意", "许棠"], "friend"),
    witness: pickStableName(work, ["顾承川", "陈若庭", "林静言", "沈亦衡", "程致远", "江晚晴"], "witness"),
    doctor: pickStableName(work, ["程医生", "陆医生", "苏医生", "沈医生"], "doctor")
  };
}

function buildMemoryLossRomanceStoryBible(work, reason = "") {
  const title = work.title || "未命名作品";
  const genre = work.genre || "原创";
  const bolder = getWorkBoldness(work) >= 71;
  const cast = buildMemoryLossRomanceCast(work);
  const chapterPlan = [
    formatChapterPlanLine(1, "我们以前认识", `${cast.female}在医院或康复期再次见到失忆后的${cast.male}，只能把旧恋人说成普通熟人。`, `${cast.female}决定不逼他恢复记忆，先守住边界。`, `${cast.male}对陌生的她产生难以解释的熟悉感。`, `${cast.male}抗拒被人替自己定义过去。`, `${cast.male}无意间说出只有两人知道的旧称呼。`),
    formatChapterPlanLine(2, "被遗忘的那几年", `通过病历、照片缺口和${cast.friend}，交代${cast.male}遗失的正是两人相爱的几年。`, `${cast.male}开始主动追问记忆空白。`, `一张被收起的合照让${cast.female}失控片刻。`, `${cast.friend}怕旧事重演，劝${cast.female}保持距离。`, `${cast.male}发现自己的手机里没有${cast.female}，却留着她常去的地址。`),
    formatChapterPlanLine(3, "像从前一样靠近", `两人在城市日常和工作往来中重新相处，${cast.male}重新认识${cast.female}。`, `${cast.female}学会把关心藏进普通朋友的分寸里。`, `${cast.male}第一次主动约她吃饭，重演过去的习惯。`, `${cast.female}害怕自己把他拉回痛苦的旧关系。`, `${cast.male}提出想去一趟梦里反复出现的旧地方。`),
    formatChapterPlanLine(4, "旧地点没有旧答案", `两人前往共同旧地寻找线索，记忆没有恢复，却找回当时的默契。`, `${cast.male}承认自己愿意相信${cast.female}。`, "旧物触发短暂记忆碎片和身体反应。", `${cast.witness}提醒${cast.female}，当年的重大事件并不只是意外。`, `${cast.male}在旧地听见自己曾经对${cast.female}说过的告白。`),
    formatChapterPlanLine(5, "不能说的那场事故", `${cast.female}和${cast.friend}的分歧公开化：是否告诉${cast.male}事故、分手与遗忘的全部真相。`, `${cast.female}必须选择保护他还是尊重他的知情权。`, `${cast.male}察觉每个人都在对自己隐瞒同一件事。`, `他认为${cast.female}接近自己带有目的，主动疏远。`, `${cast.female}收到与事故有关的人发来的消息。`),
    formatChapterPlanLine(6, "这一次是我先喜欢你", `${cast.male}在疏远后发现自己真正想见的人仍是${cast.female}，开始以现在的自己重新追她。`, `${cast.male}从被动等待记忆变成主动做选择。`, `没有旧记忆的告白让${cast.female}意识到他不是因为过去才靠近。`, `${cast.female}不敢接受，怕他恢复记忆后再次后悔。`, `${cast.male}说出一句和过去完全相同的话。`),
    formatChapterPlanLine(7, "共同好友的证词", `${cast.friend}说出部分真相：事故前两人因重大事件发生过激烈争执。`, `${cast.male}接受过去的自己也可能伤害过人。`, `三人把多年的误会摊开，关系从偏袒变成互相理解。`, `线索显示事故或分手背后还有${cast.witness}这一未被说出的责任人。`, `${cast.male}找到事故当天未发送出去的一段录音。`),
    formatChapterPlanLine(8, "记忆先回来的是痛", `录音和现场重访触发${cast.male}恢复零碎记忆，先想起争吵和失去。`, `${cast.female}不再替他决定真相，而是陪他面对。`, `${cast.male}终于确认${cast.female}不是陌生人，而是自己最重要的人。`, `记忆碎片与现实细节不一致，说明${cast.witness}一直改写叙述。`, `${cast.male}记起自己在事故前见过${cast.witness}。`),
    formatChapterPlanLine(9, "没有人能替谁原谅", `重大事件真相揭开：${cast.male}与${cast.female}的分开各有责任，外部压力只是导火索。`, `${cast.male}学会承担失忆前的选择，而非把一切推给事故。`, `${cast.female}说出多年未说的委屈和仍未消失的爱。`, `两人不能立刻复合，必须先处理真相造成的伤害。`, `${cast.witness}提出一个会再次改变两人生活的条件。`),
    formatChapterPlanLine(10, "想起你以后", `${cast.male}的完整记忆回归，发现最残忍的不是忘记，而是想起后仍要面对自己曾经的逃避。`, `${cast.male}把过去的愧疚转成具体补偿和行动。`, `他拒绝用旧记忆要求${cast.female}立刻回头。`, `${cast.female}担心他爱的是过去的自己，而不是现在的她。`, `${cast.male}拿出一份只属于现在的重新开始计划。`),
    formatChapterPlanLine(11, "重新认识一次", `两人不以复合为终点，而是重新约会、重新建立信任和共同生活的规则。`, `${cast.female}从等待被选择变成主动提出自己的边界。`, `旧友圈见证两人终于能平静谈起过去。`, `重大事件的余波仍在，现实选择逼近。`, `${cast.male}收到一份来自过去的最后证据。`),
    formatChapterPlanLine(12, "再一次，喜欢你", `第一卷收束：${cast.male}与${cast.female}处理最后证据，确认爱不是记忆自动恢复后的惯性，而是再次选择。`, `两人学会把过去当作共同经历，而非彼此的枷锁。`, `${cast.male}以新的身份和方式告白，${cast.female}给出带条件的回应。`, `未来仍有家庭、职业或旧事余波，不能用一句和好结束。`, `第二卷钩子：过去留下的人或事，再次要求${cast.male}与${cast.female}作出共同决定。`)
  ].join("\n");

  return {
    storyBible: {
      logline: `${title}：一场事故让${cast.male}遗忘了与${cast.female}相爱的数年。${cast.female}把自己藏回“普通熟人”的位置，却在他重新爱上自己、并逐步想起旧日真相时，不得不一起面对那场让他们分开的重大事件。`,
      theme: "记忆可以消失，选择不会自动重来；真正的重逢不是回到从前，而是在知道伤害之后仍愿意重新认识彼此。",
      tone: bolder ? "都市情感悬压更强，秘密揭露更快，但每次反转都服务两人的情感选择。" : "克制细腻的都市情感，靠日常细节、失而复得的熟悉感和逐步揭开的旧事推进。",
      genrePositioning: `${genre}｜都市情感｜失忆重逢｜双向暗恋式复合｜现实向成长`,
      worldview: "当代都市生活是故事的真实舞台：事故后的医院与康复期、两人各自的工作节奏、共同好友的社交圈、保留旧回忆的街区和那场重大事件留下的现实后果。世界观重点不是超自然设定，而是“失忆后一个人如何重新拥有自己的过去，以及另一个人如何在爱与边界之间做选择”。",
      rules: `记忆规则：${cast.male}遗失的是两人相识、相恋到事故前后的数年，不应在一次刺激后全部恢复；每次记忆碎片都要由地点、物件、话语或情绪触发，并带来新的误解或选择。情感规则：${cast.female}不能替${cast.male}决定真相，${cast.male}也不能用恢复的记忆要求立刻原谅。现实规则：重大事件必须有可追溯的责任、证据和余波，不能靠偶然巧合一笔带过。`,
      era: `当代城市，事故发生数年后。故事从${cast.male}恢复意识、${cast.female}以“旧识”身份重新进入他的生活开始。`,
      characters: [
        `${cast.male}：事故后失去数年记忆的普通都市青年｜目标：找回被删空的人生并确认自己现在想要什么｜秘密/弱点：对被隐瞒极度敏感，记忆恢复时先想起痛苦片段｜成长弧：从等待别人解释过去，变成主动承担旧选择并重新去爱。`,
        `${cast.female}：${cast.male}失忆前的恋人，如今只承认两人“以前认识”｜目标：保护他的恢复过程，也保护自己不再被旧伤拖回去｜秘密/弱点：知道重大事件的关键一环，却害怕说出真相会再次失去他｜成长弧：从克制等待他想起，变成提出边界、要求平等选择。`,
        `${cast.friend}：两人过去关系的见证者｜目标：不让${cast.male}与${cast.female}重演事故前后的伤害｜秘密/弱点：曾在关键时刻劝过或瞒过其中一人，因此带着愧疚｜成长弧：从偏袒保护变成提供完整证词。`,
        `${cast.witness}：与重大事件直接相关的人｜目标：维护自己的叙述与利益，避免旧事被彻底翻出｜秘密/弱点：掌握决定两人分开真相的证据，却并非纯粹恶意｜成长弧：在现实代价面前被迫交出真相。`,
        `${cast.doctor}：${cast.male}恢复期的专业支持者｜目标：保证记忆恢复不被情绪和外界刺激强行操控｜秘密/弱点：知道记忆不可能按所有人期待的顺序回来｜成长弧：从旁观者变成提醒二人尊重当下选择的边界角色。`
      ].join("\n"),
      relationships: [
        `${cast.male} -> ${cast.female}：旧恋人 / 现在被称作旧识｜他感到熟悉却不知来由，她害怕告诉他全部过去｜核心矛盾是爱意重新出现时，真相能否被平等说出。`,
        `${cast.female} -> ${cast.friend}：共同守秘者｜两人都想保护${cast.male}，却对“隐瞒是不是伤害”意见相反｜中段因证词和真相公开发生冲突。`,
        `${cast.male} -> ${cast.friend}：旧友与调查对象｜${cast.male}需要对方补全过去，同时怀疑对方参与了隐瞒｜关系从不信任走向理解。`,
        `${cast.female} -> ${cast.witness}：被旧事牵制的对立者｜对方掌握重大事件证据，${cast.female}害怕他再次伤害${cast.male}｜后期必须正面追问责任。`,
        `${cast.male} -> ${cast.doctor}：恢复期的信任关系｜${cast.doctor}阻止他用冲动刺激强行找回记忆｜提醒他即使记忆恢复也要对现在的选择负责。`
      ].join("\n"),
      factions: "医院与恢复期支持系统负责现实边界；两人的共同好友圈保存了被切碎的过去；男主和女主各自的工作环境提供日常相遇、独立生活和现实压力；旧事知情人所在的关系网络承担真相揭露与责任追究。",
      locations: "医院或康复中心（重逢起点）、两人曾常去却被男主遗忘的餐馆/街区（记忆触发点）、共同好友的聚会场所（证词与关系冲突）、事故相关地点（真相转折）、男主与女主各自的工作场景（重新认识彼此的日常舞台）。",
      conflict: `${cast.male}想找回过去，${cast.female}却害怕过去本身会再次摧毁他。两人一边在现在重新靠近，一边被${cast.friend}的隐瞒、${cast.witness}的证据和重大事件的责任逼着回头。真正的难题不是记忆能否恢复，而是恢复以后他们是否还能以平等的方式重新选择彼此。`,
      antagonistPressure: bolder ? "旧事知情人提前抛出片段真相，迫使两人在错误信息中互相伤害；每次记忆恢复都打乱当下关系。" : "记忆碎片、女主的克制、共同好友的沉默和现实责任层层施压，让两人无法只靠怀旧复合。",
      foreshadowing: "被删除却总会出现的地址、男主脱口而出的旧称呼、一张被藏起的合照、事故当天未发送的录音、共同好友反复回避的日期、旧事知情人留下的半句解释。",
      continuityNotes: `AI 写作必须守住“${cast.male}失忆、${cast.female}未主动承认旧恋人身份、两人在当下重新靠近、重大事件尚未完全揭开”这四条状态。不要把${cast.male}写成已经恢复全部记忆；不要让${cast.female}无理由立刻原谅；每次甜蜜推进都要伴随一个关于信任或真相的现实问题。`,
      outline: "第一阶段：重逢与隐瞒。男主把女主当旧识，女主决定守住分寸，熟悉感开始出现。\n第二阶段：再次靠近。共同旧地、日常相处和朋友聚会让男主主动走近女主，旧物开始触发记忆。\n第三阶段：隐瞒反噬。男主发现每个人都知道过去，女主与共同好友因是否坦白发生分歧，关系跌入低谷。\n第四阶段：重新爱上。男主在没有完整记忆的情况下再次选择女主，二人开始共同调查重大事件。\n第五阶段：记忆与真相。碎片回归、旧事知情人现身，事故与分手责任被完整揭开。\n第六阶段：重新选择。两人不靠“恢复从前”解决问题，而是在知道彼此伤害后重新建立信任，并为下一卷现实压力做好共同决定。",
      chapterPlan
    },
    fallback: true,
    warning: reason || "已使用都市失忆重逢题材的本地设定模板。"
  };
}

function buildSyntheticPersonSpaceStoryBible(work, reason = "") {
  const title = work.title || "人造月光";
  const genre = work.genre || "原创";
  const bolder = getWorkBoldness(work) >= 71;
  const hunter = pickStableName(work, ["沈砚川", "陆闻舟", "顾沉", "谢临", "程昼"], "synthetic-hunter");
  const android = pickStableName(work, ["祁月", "苏月白", "闻星", "黎雾", "温遥"], "synthetic-android");
  const partner = pickStableName(work, ["唐迦", "周既明", "姜岚", "宋栩", "林见川"], "synthetic-partner");
  const auditor = pickStableName(work, ["裴言", "许苒", "乔衡", "闻岚", "程澈"], "synthetic-auditor");
  const antagonist = pickStableName(work, ["赫连策", "顾司衡", "秦曜", "裴铎", "闻修远"], "synthetic-antagonist");
  const chapterPlan = [
    formatChapterPlanLine(1, "销毁清单上的月亮", `${hunter}受雇拦截一艘前往拆解厂的货船，却在清单上发现一名拥有完整人格记录的仿生人${android}。`, `${hunter}从只看赏金的独行者，第一次主动质疑委托。`, `${android}在报废舱醒来，用一段不该存在的童年记忆证明自己不是货物。`, "委托方的合法手续齐全，救人等于劫持证物。", `货船自爆倒计时启动，${android}说自己知道一桩会吞掉整座星港的命案。`),
    formatChapterPlanLine(2, "她没有逃跑程序", `${hunter}带${android}逃入边缘星港，验证她的记忆与人格核是否被人为伪造。`, `${android}学会在不依赖主人指令的情况下作出选择。`, `${android}拒绝逃离，反而替${hunter}拆掉追踪器。`, "仿生人管理局发布高额回收令，称她携带危险人格病毒。", `${partner}认出${android}的序列号，提醒这是一项被封存的人格实验。`),
    formatChapterPlanLine(3, "赏金令改写", `${hunter}发现自己也被列为“协助失控仿生人”的通缉对象，只能和${android}共同接下小委托换取燃料与情报。`, `${hunter}开始把战斗习惯变成团队协作。`, `两人在失控采矿站救下被困工人，${android}以极短时间重建站内导航。`, `救人暴露了${android}异常的权限等级，追兵锁定他们的航线。`, `被救工人交出一段录像：${android}曾在另一具身体里出现过。`),
    formatChapterPlanLine(4, "人格听证会", `${auditor}提出合作：带${android}进入中立听证站，才能证明她拥有法律人格，而不是被直接销毁。`, `${android}开始理解“被承认”不等于“被拥有”。`, "听证会上她复述一段被删除的人类证词，逼得官员当场失态。", "程序要求她交出全部记忆供审查，这会让她失去最重要的自我连续性。", `${hunter}在公开场合选择站到她一边，彻底失去旧赏金网络。`),
    formatChapterPlanLine(5, "月背的记忆仓", `线索指向废弃月背城，${hunter}、${android}与${partner}潜入保存人格备份的冷库。`, `${hunter}学会承认自己曾替错误制度做事。`, `${android}找回一段记忆：她原本是为保护证人而诞生的守护型人格。`, "冷库中的备份彼此矛盾，谁都可能是被篡改后的“原件”。", `他们发现${antagonist}准备把人格备份打包出售给边境军团。`),
    formatChapterPlanLine(6, "复制人不止一个", `${android}面对数个拥有相同记忆的副本，必须决定谁该被唤醒、谁会被永远留在冷库。`, `${android}从证明“我是真的”转向承担“我选择成为谁”。`, "她用自己的记忆片段唤醒一名被遗弃的仿生工人，第一次主动帮助同类。", "每唤醒一个副本，${android}的记忆稳定度都会下降。", `${partner}坦白他曾参与该项目的运输环节。`),
    formatChapterPlanLine(7, "猎人与猎物", `${hunter}的旧雇主派出顶级猎手追捕他们，逼他面对过去靠赏金维生时造成的伤害。`, `${hunter}从逃亡者变成愿意制定反制计划的领队。`, `${hunter}利用赏金猎人规则反向发布假坐标，让追兵互相牵制。`, `旧雇主掌握${hunter}的真实债务与身份记录，能让他永远失去星际通行权。`, `追兵留下消息：${android}体内存着一份足以推翻人格法案的原始证据。`),
    formatChapterPlanLine(8, "被出售的月光", `${antagonist}启动拍卖会，准备出售仿生人格技术；众人必须在不引爆星港战争的前提下潜入交易舰。`, `${partner}用过去的罪疚换取一条危险的内线。`, `${android}以“商品”身份走进拍卖场，却把买家的隐私证据投向全舰。`, `她必须伪装顺从，${hunter}无法确认她是否仍站在同一边。`, `拍卖记录显示：${android}的人格原型来自一名已经失踪的人类证人。`),
    formatChapterPlanLine(9, "谁拥有记忆", `原型证人的身份揭开，${android}发现自己并非复制某个人，而是继承了许多被掩埋的求救记录。`, `${android}建立自己的道德边界，不再把人类原型当作唯一答案。`, "她拒绝用揭露他人隐私来换取自由，选择公开制度漏洞。", "真相会连带伤害仍在世的证人家属，公开与保护无法两全。", `${auditor}拿出秘密证据：人格法案的漏洞是被故意保留的。`),
    formatChapterPlanLine(10, "星港停电夜", `${antagonist}切断星港能源制造混乱，试图在恐慌中证明仿生人格不可控。`, `${hunter}学会把控制权交给${android}和伙伴。`, `${android}接入星港旧网，救下被困平民，却拒绝接管任何人的私人设备。`, `她的连接会被宣传成“AI 入侵”，舆论迅速倒向销毁派。`, `停电恢复时，所有屏幕都留下同一句未知留言：下一批人格将被送往前线。`),
    formatChapterPlanLine(11, "自由不是赦免", `${hunter}与${android}决定不再只为一人翻案，而是护送一批即将销毁的仿生人前往中立星域。`, `${hunter}从保护一个人走向承担更大的选择。`, "曾经追捕他们的猎手倒戈，为平民航线打开缺口。", "护送队伍里有人不信任${android}，她必须接受自由也意味着被拒绝。", `${antagonist}亲自登舰，提出以${hunter}的自由交换${android}的自毁。`),
    formatChapterPlanLine(12, "人造月光", `第一卷收束：${android}拒绝被任何人定义为人或工具，${hunter}也拒绝回到旧秩序；二人公开原始证据并带队穿过封锁。`, `${android}把不稳定的人格核转化为可自主选择的意识锚点。`, "月光号冲出封锁线，仿生人与人类第一次共同保住一座星港。", "胜利让两人成为制度两端的象征，新的追捕会更残酷。", `第二卷钩子：失踪的人类原型留下坐标，指向一座从未登记的“人格培育城”。`)
  ].join("\n");

  return {
    storyBible: {
      logline: `${title}：在仿生人是否拥有“人格”仍被文明争论的时代，赏金猎人${hunter}劫走即将被销毁的仿生人${android}；他们一边追查人格实验的原始证据，一边被管理局、旧雇主与星际资本追捕。`,
      theme: "人格不是被制造的标签，而是一个个体能否拥有选择、责任与被看见的权利。",
      tone: bolder ? "星际逃亡节奏快、阴谋反转更强，但每次胜利都要付出身份、记忆或信任代价。" : "冷峻而有人情味的星际追捕，动作场面与人格伦理、伙伴信任并行。",
      genrePositioning: `${genre}｜星际科幻｜仿生人伦理｜赏金猎人搭档｜逃亡与追捕｜人格悬疑`,
      worldview: "故事发生在多个星港、月背殖民地与中立听证站组成的星际文明。仿生人可以承担劳动、医疗、护卫与航行工作，却未被普遍承认为完整人格；一旦被标记为“失控”或“资产争议”，可由持证机构回收、拆解或格式化。人类社会并非铁板一块：销毁派担心失控与失业，权利派要求人格平等，资本方则把意识数据当作可交易资源。",
      rules: `人格规则：仿生人的记忆、情绪与选择记录共同构成意识连续性，强制格式化等同于杀死原有个体。权限规则：仿生人能接入特定系统，但每次越权连接都会留下可追踪痕迹，并损伤人格核稳定度。法律规则：听证会可以认证人格，但认证过程要求交出记忆审查，制度本身存在被资本操控的漏洞。战斗规则：${hunter}依靠赏金猎人的装备、航线情报与战术；${android}依靠计算、语言与有限系统连接，不能无限入侵或一人解决危机。`,
      era: "人类已进入星际扩张成熟期，星港间存在松散联盟与企业自治。故事从一艘报废货船开始，逐步扩大到人格法案、星际拍卖与边境前线。",
      characters: [
        `${hunter}：跨域赏金猎人｜目标：从这桩委托中活下来，并查清自己为何被卷入人格实验｜秘密/弱点：曾替企业做过不愿回看的脏活，对承诺和“保护”缺乏信心｜成长弧：从只为报酬行动，变成愿意为他人的选择承担代价。`,
        `${android}：女性外观的成人仿生人，待销毁序列的唯一幸存者｜目标：确认自己是否拥有独立人格，并保护体内的原始证据｜秘密/弱点：记忆里混有多名证人的片段，越强行调用越可能失去自我连续性｜成长弧：从请求别人承认自己是“人”，变成主动定义自己的边界与责任。`,
        `${partner}：${hunter}的旧搭档兼星港情报贩子｜目标：补偿自己参与运输人格实验的过失｜秘密/弱点：曾为保命向企业提供过一条航线｜成长弧：从两边下注的幸存者，变成愿意公开证词的盟友。`,
        `${auditor}：中立人格听证站审计官｜目标：在制度内部保住程序正义｜秘密/弱点：掌握法案漏洞，却一直只敢匿名留档｜成长弧：从谨慎的规则执行者，变成愿意承担公开真相后果的人。`,
        `${antagonist}：人格技术公司高管与拍卖会操盘者｜目标：把人格备份变成可控资产，维持企业与法案的利益链｜秘密/弱点：项目早期的事故记录与他直接相关｜成长弧：在主角不断公开证据后，从幕后操盘者被迫亲自下场。`
      ].join("\n"),
      relationships: [
        `${hunter} -> ${android}：劫持者与被救者｜从互相利用到共同选择航线｜矛盾：他害怕再替别人决定命运，她不愿成为被保护的物品。`,
        `${hunter} -> ${partner}：旧搭档｜表面互相算计，关键时刻仍会救对方｜矛盾：${partner}隐瞒过实验运输记录。`,
        `${android} -> ${auditor}：被审查者与制度内证人｜一方需要法律承认，一方需要真实证据｜矛盾：认证程序可能伤害${android}的记忆。`,
        `${android} -> ${antagonist}：实验样本与项目操盘者｜对方把她当作资产和证据容器｜矛盾：她的存在本身能毁掉对方的利益链。`,
        `${hunter} -> ${antagonist}：前雇员与追捕目标｜${antagonist}掌握他的旧债和身份记录｜矛盾：他必须承认过去造成的伤害，才能摆脱控制。`
      ].join("\n"),
      factions: "仿生人格管理局负责回收、认证与风险处置；赫曜人格技术公司控制大部分人格备份与运输链；中立听证站是少数能挑战回收令的法律空间；边缘星港的赏金猎人、走私者与工人联盟提供灰色地带的资源；边境军团是企业准备出售人格武器化技术的最终买家。",
      locations: "报废货船与拆解厂（开局救援）、边缘星港（逃亡和委托据点）、中立人格听证站（法律对决）、月背记忆冷库（寻找原始证据）、拍卖交易舰（中段高潮）、停电星港与封锁航线（第一卷收束）。",
      conflict: `${hunter}最初只想从委托里脱身，${android}只想活下来，但两人发现她体内的证据会揭开人格法案被资本利用的真相。公开真相会伤害无辜证人，也会让更多仿生人被立即清算；沉默则等于默认${android}被当作资产销毁。主线必须在“保护一个具体的人”与“改变一套会伤人的制度”之间不断升级。`,
      antagonistPressure: bolder ? `${antagonist}会提前发动星港停电、发布伪造失控证据，并用${hunter}过去的记录离间队伍；每次反制都让追捕范围扩大。` : "回收令、赏金网络、听证程序、旧雇主与企业舆论逐层施压，让二人无法只靠逃跑解决问题。",
      foreshadowing: `${android}梦见并不属于自己的月背城市；被删去的船货清单反复出现同一编号；${hunter}旧委托里藏着人格实验运输记录；听证站档案出现一名失踪人类证人的签名；每个苏醒的仿生人都记得同一句未完成的求救话。`,
      continuityNotes: `AI 写作必须守住：${android}是拥有自主选择的仿生人，不是工具或恋爱陪衬；${hunter}不能用“保护”代替她作决定；人格证据要分阶段揭露，不能一章解决整个制度；系统连接有代价，追捕者会随公开行动升级。每章至少推进逃亡、证据、信任或人格选择中的一项。`,
      outline: `第一阶段：劫走与逃亡。${hunter}从销毁货船救下${android}，二人因回收令成为通缉对象。\n第二阶段：证明与追踪。边缘星港委托、人格听证和月背冷库让他们确认这不是单一事故。\n第三阶段：复制与背叛。人格副本、旧搭档隐瞒和赏金猎人追捕逼迫队伍选择信任。\n第四阶段：交易与公开。拍卖舰、原型证人和制度漏洞被逐步揭开，${android}拒绝成为任何人的资产。\n第五阶段：星港危机。${antagonist}制造停电与舆论恐慌，主角必须证明自由不等于失控。\n第六阶段：穿越封锁。二人护送被销毁者逃往中立星域，并把更大的“人格培育城”作为第二卷目标。`,
      chapterPlan
    },
    fallback: true,
    warning: reason || "已使用仿生人星际追捕题材的本地设定模板。"
  };
}

function buildLocalStoryBible(work, reason = "") {
  if (isSuperSeminarySystemFanfic(work)) {
    return buildSuperSeminaryStoryBible(work, reason);
  }

  if (isMemoryLossRomance(work)) {
    return buildMemoryLossRomanceStoryBible(work, reason);
  }

  if (isSyntheticPersonSpaceStory(work)) {
    return buildSyntheticPersonSpaceStoryBible(work, reason);
  }

  const title = work.title || "未命名作品";
  const genre = work.genre || "原创";
  const premise = work.premise || "主角在关键选择前发现旧生活背后隐藏着秘密";
  const bolder = getWorkBoldness(work) >= 71;
  const protagonist = pickStableName(work, ["林舟", "顾临川", "沈言", "陆野", "许川"], "original-protagonist");
  const ally = pickStableName(work, ["苏晚", "程予安", "周岚", "叶知微", "唐栖"], "original-ally");
  const rival = pickStableName(work, ["贺沉", "顾行之", "秦越", "裴衡", "周谨"], "original-rival");
  const witness = pickStableName(work, ["江宁", "许青禾", "陈屿", "宋昭", "黎川"], "original-witness");
  return {
    storyBible: {
      logline: `${title}：围绕“${premise}”展开，但重点不复述简介，而是设计主角目标、对手压力、阶段成长和连续章节推进。`,
      theme: "身份、选择、代价与成长。",
      tone: bolder ? "冲突强、反转多、节奏快，但每次反转都要能回扣主线。" : "节奏稳、人物动机清楚、每章都有推进。",
      genrePositioning: `${genre}｜长篇连载｜主线推进型`,
      worldview: `故事世界围绕作者给定前提建立：${premise}。需要补足日常秩序、核心规则、主要矛盾来源、主角必须进入的舞台和敌方压力链。`,
      rules: "核心规则必须简单清楚：能力/资源有来源，使用有代价，敌方会根据主角行动升级策略。",
      era: "按作品类型设定为现代、架空或异世界；后续可在一句话梗概中继续细化。",
      characters: `${protagonist}：故事主角｜目标：解决眼前危机并查清它为何找上自己｜秘密/弱点：习惯独自承担，对关键真相只掌握一部分｜成长弧：从被事件推着走，变成主动决定要保护什么。\n${ally}：主角的进入者与同行者｜目标：阻止局面失控，同时坚持自己的价值边界｜秘密/弱点：与事件的源头有旧联系，却不敢完全坦白｜成长弧：从试探主角到选择并肩承担。\n${rival}：掌握资源或规则优势的对手｜目标：维持现有利益与秩序，阻止主角触及核心真相｜秘密/弱点：其优势建立在一条不能公开的旧交易上｜成长弧：从幕后施压到被迫亲自下场。\n${witness}：知道关键过去的证人｜目标：保护自己与身边人，不再被旧事拖回危险｜秘密/弱点：保存着能改变局势的证据，却担心公开代价｜成长弧：从沉默旁观变成提供完整证词。`,
      relationships: `${protagonist} -> ${ally}：合作伙伴｜从互相试探到共同制定计划｜矛盾：${ally}隐瞒了与事件源头的旧联系。\n${protagonist} -> ${rival}：目标人物与阻碍者｜对手用资源和规则压制主角｜矛盾：主角越接近真相，${rival}越会升级手段。\n${ally} -> ${witness}：旧识与守秘者｜两人都知道部分过去｜矛盾：是否公开证据会让他们站到不同立场。\n${protagonist} -> ${witness}：调查者与证人｜主角需要证词来确认方向｜矛盾：证人不相信主角能承受真相。`,
      factions: `明面组织负责维持日常秩序并掌握合法资源；${rival}所在的利益网络制造信息差和现实压力；${ally}与${witness}连接的第三方群体掌握旧线索，却担心公开后失去现有生活。`,
      locations: `故事起点是${protagonist}第一次无法回避事件的日常场所；中段进入${ally}熟悉的成长或训练地点；${witness}保存证据的旧地点承担记忆回收；${rival}控制的公开场所用于阶段对决；最终高潮发生在所有关系必须公开站队的地方。`,
      conflict: `${protagonist}越接近目标，越会发现解决问题需要付出代价，并可能伤害或改变原本想保护的人。核心难题不是打败${rival}，而是在证据、关系和现实后果都摆到台面时，仍能做出自己的选择。`,
      antagonistPressure: bolder ? `${rival}会主动制造误导、牺牲次要利益并提前引爆隐藏规则，迫使${protagonist}在错误信息中做选择。` : `${rival}通过信息差、资源差和情感牵制阻止${protagonist}，让每次小胜都带来新的现实代价。`,
      foreshadowing: `早期埋下异常物件、重复话语、被遮掩的记录和${witness}回避的话题；中段回收${ally}的旧联系；后段揭开${rival}赖以控制局面的原始交易。`,
      continuityNotes: `AI 续写时不得随意改变${protagonist}的目标、核心规则、${ally}的立场和已铺设线索。新增设定必须解释或推进现有冲突；每章至少推进调查、关系、代价或对抗中的一项。`,
      outline: `第一阶段：事件闯入。${protagonist}确认目标与限制，发现日常秩序并不可靠。\n第二阶段：结盟与试探。${ally}带主角进入更大舞台，二人因隐瞒建立第一次矛盾。\n第三阶段：证据与代价。${witness}提供片段真相，${rival}升级施压，主角第一次因选择付出代价。\n第四阶段：主动反击。主角厘清真正矛盾，反向利用规则和关系逼出${rival}的破绽。\n第五阶段：阶段高潮。旧交易被公开，人物各自站队，解决一条主线并开启更大压力。`,
      chapterPlan: [
        formatChapterPlanLine(1, "失控的开端", `${protagonist}被一件具体事件逼出日常，必须在有限时间内做出选择。`, "确认外在目标与最明显弱点。", "第一次用自己的判断避开小危机。", "不知道谁在暗中推动事件。", `收到来自${ally}的异常线索。`),
        formatChapterPlanLine(2, "规则不是答案", `${ally}说明局面的规则与代价，${protagonist}决定暂时合作。`, "获得第一项可用资源或情报渠道。", "利用新线索解决眼前麻烦。", `${ally}刻意隐瞒了事件的一部分。`, `${rival}注意到主角的行动。`),
        formatChapterPlanLine(3, "证人的沉默", `${protagonist}找到${witness}，却只得到一段被截断的证词。`, "学会不靠逼问而是交换信任。", "证词指向一个出乎意料的旧地点。", `${witness}担心公开后会失去现有生活。`, "证据被人抢先转移。"),
        formatChapterPlanLine(4, "第一次站队", `${protagonist}和${ally}在旧地点拿到部分证据，并第一次公开选择彼此。`, "从独自行动转向共同制定计划。", "二人联手反制一次跟踪或规则压迫。", `${rival}用合法身份反咬主角越界。`, "证据显示事件牵涉的人比预想更多。"),
        formatChapterPlanLine(5, "代价落地", `${rival}把压力落到主角身边的人或现实资源上。`, "主角承认一个自己一直回避的错误。", "在损失中保住最关键的一条线索。", `${ally}的隐瞒被揭开，合作濒临破裂。`, "主角发现真正的目标并非眼前对手。"),
        formatChapterPlanLine(6, "各自的真相", `${ally}与${witness}分别讲出过去的部分真相，主角重新判断该相信谁。`, "学会区分事实、立场和情绪。", "拼出事件的第一条完整因果链。", "完整真相会伤害所有人，没人愿意先说。", `${rival}提出一个看似合理的交换条件。`),
        formatChapterPlanLine(7, "反向布局", `${protagonist}拒绝被牵着走，利用规则漏洞让${rival}先暴露。`, "形成自己的行动策略。", "对手第一次在公开场合失手。", "主角也因此失去一项重要保护。", `旧交易的原件浮出水面。`),
        formatChapterPlanLine(8, "关系临界点", `${protagonist}必须在保护${ally}与推进真相之间做选择。`, "学会把选择说清楚，而不是替别人决定。", "两人不靠误会分开，而是谈清边界后继续合作。", `${witness}仍拒绝给出最后证词。`, "证人遭遇直接威胁。"),
        formatChapterPlanLine(9, "被迫公开", `${rival}发动最后一轮舆论或资源压迫，主角决定把事件推向公开场域。`, "从私下解决问题转向承担公开后果。", "关键证据被多人验证，反转局面。", "公开会连带暴露主角自己的弱点。", `${rival}准备孤注一掷。`),
        formatChapterPlanLine(10, "第一卷的选择", `主角与伙伴处理${rival}的反扑，完成第一条主线并确认下一阶段目标。`, "把被动求生变成主动选择。", "以明确行动兑现前期承诺。", "胜利不能消除所有伤害，关系仍需修复。", "更大的幕后线索指向下一卷。")
      ].join("\n")
    },
    fallback: true,
    warning: reason || "测试模型生成设定库。"
  };
}

function validateStoryBibleQuality(work, storyBible) {
  const bible = normalizeStoryBible(storyBible);
  const combined = Object.values(bible).join("\n");
  const issues = [];
  const characterLines = String(bible.characters || "").split(/\r?\n+/).filter((line) => /[：:]/.test(line));
  const relationshipLines = String(bible.relationships || "").split(/\r?\n+/).filter((line) => /(?:->|→)/.test(line));

  if (!bible.worldview || !bible.characters || !bible.conflict || !bible.outline || !bible.chapterPlan) {
    issues.push("缺少世界观、人物、冲突、大纲或章节规划");
  }

  const chapterLines = String(bible.chapterPlan || "").split(/\r?\n+/).filter((line) => line.trim());
  if (chapterLines.length < 8) {
    issues.push("章节规划少于 8 章，无法支撑长篇推进");
  }

  if (!/剧情目标：/.test(bible.chapterPlan) || !/成长点：/.test(bible.chapterPlan) || !/爽点：/.test(bible.chapterPlan) || !/结尾钩子：/.test(bible.chapterPlan)) {
    issues.push("章节规划没有包含剧情目标、成长点、爽点和结尾钩子");
  }

  if (/异常出现|第一次追查|禁区|旧资料|隐藏真相|旧档案/.test(bible.chapterPlan) && isSuperSeminarySystemFanfic(work)) {
    issues.push("章节规划仍是通用悬疑模板");
  }

  const premise = normalizeText(work.premise);
  if (premise.length > 30) {
    const repeated = Object.values(bible).filter((value) => String(value || "").includes(premise)).length;
    if (repeated >= 2) {
      issues.push("过度复读用户简介，没有拆解成具体设定");
    }
  }

  if (isSuperSeminarySystemFanfic(work)) {
    const required = ["葛小伦", "卢小鱼", "系统", "雄兵连", "超神学院", "卡尔", "虚空"];
    const missing = required.filter((keyword) => !combined.includes(keyword));
    if (missing.length >= 2) {
      issues.push(`缺少题材核心关键词：${missing.join("、")}`);
    }

    const canonSignals = ["银河之力", "饕餮", "天使", "恶魔", "杜卡奥", "巨峡号", "反虚空"];
    const hitCount = canonSignals.filter((keyword) => combined.includes(keyword)).length;
    if (hitCount < 3) {
      issues.push("与原作世界、势力和战力体系关联不足");
    }
  } else {
    const leakedKeywords = SUPER_SEMINARY_KEYWORDS.filter((keyword) => combined.includes(keyword));
    if (leakedKeywords.length >= 3) {
      issues.push("生成结果混入了与当前标题和梗概无关的其他作品设定");
    }
  }

  if (isMemoryLossRomance(work)) {
    const romanceSignals = ["失忆", "遗忘", "记忆", "重逢", "恋人", "喜欢", "爱"];
    const romanceHits = romanceSignals.filter((keyword) => combined.includes(keyword)).length;
    if (romanceHits < 4) {
      issues.push("没有围绕失忆重逢的核心情感矛盾展开");
    }

  }

  if (characterLines.length < 4) {
    issues.push("人物设定少于 4 个可区分角色");
  }
  if (relationshipLines.length < 3) {
    issues.push("关系网缺少可生成箭头的明确人物关系");
  }
  if (/^(男主|女主|共同好友|旧事知情人|医生|主角|盟友|对手)[：:]/m.test(String(bible.characters || ""))) {
    issues.push("人物仍使用主角、男主等占位名，缺少可辨识姓名");
  }

  if (combined.length < 1800) {
    issues.push("设定库内容太短，缺少可执行细节");
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function assessStoryBibleQuality(work, storyBible) {
  const bible = normalizeStoryBible(storyBible);
  const validation = validateStoryBibleQuality(work, bible);
  const chapterLines = String(bible.chapterPlan || "").split(/\r?\n+/).filter((line) => line.trim());
  const checks = [
    {
      label: "核心栏目完整",
      passed: Boolean(bible.worldview && bible.characters && bible.conflict && bible.outline && bible.chapterPlan),
      detail: "世界观、人物、冲突、大纲、章节规划"
    },
    {
      label: "章节可执行",
      passed: chapterLines.length >= 8 && /剧情目标：/.test(bible.chapterPlan) && /成长点：/.test(bible.chapterPlan) && /爽点：/.test(bible.chapterPlan) && /结尾钩子：/.test(bible.chapterPlan),
      detail: `已规划 ${chapterLines.length} 章，要求包含目标、成长点、爽点、钩子`
    },
    {
      label: "内容细节充足",
      passed: Object.values(bible).join("\n").length >= 1800,
      detail: "设定库应提供后续写作可直接使用的细节"
    },
    {
      label: "题材一致性",
      passed: !validation.issues.some((item) => /题材核心关键词|原作世界|混入了与当前标题|通用悬疑模板|失忆重逢/.test(item)),
      detail: "设定应与当前作品标题、梗概和题材保持一致"
    },
    {
      label: "人物关系可用",
      passed: !validation.issues.some((item) => /人物设定少于|关系网缺少|人物仍使用/.test(item)),
      detail: "使用姓名与“甲 -> 乙”关系，可生成关系图"
    }
  ];
  const score = Math.max(0, Math.round((checks.filter((item) => item.passed).length / checks.length) * 100 - validation.issues.length * 4));
  return {
    ok: validation.ok,
    score,
    level: score >= 90 ? "优秀" : score >= 75 ? "可用" : score >= 55 ? "待完善" : "需要重做",
    checks,
    issues: validation.issues,
    checkedAt: nowIso()
  };
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    throw new Error("AI 没有返回设定库内容。");
  }

  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }

  throw new Error("AI 返回的设定库不是有效 JSON，请重新生成。");
}

async function callStoryBibleGenerator(work) {
  const config = getAiConfig(true);
  const apiKey = config.apiKey;
  const model = config.model || DEFAULT_OPENAI_MODEL;

  if (isTestAiEnabled()) return buildTestStoryBible(work);
  if (!apiKey) throw aiUnavailableError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const prompt = buildStoryBiblePrompt(work);

  try {
    let payload;
    let text = "";
    if (config.endpoint === "chat") {
      const requestBody = {
        model,
        messages: [
          { role: "system", content: "你是中文长篇小说故事圣经策划编辑。只输出 JSON，不要解释。" },
          { role: "user", content: prompt }
        ],
        temperature: temperatureFromBoldness(getWorkBoldness(work)),
        max_tokens: getMaxOutputTokens()
      };
      payload = await fetchAiJson(`${config.baseUrl}/chat/completions`, apiKey, requestBody, controller.signal);
      text = payload?.choices?.[0]?.message?.content || "";
    } else {
      const requestBody = {
        model,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "你是中文长篇小说故事圣经策划编辑。只输出 JSON，不要解释。" }]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }]
          }
        ],
        temperature: temperatureFromBoldness(getWorkBoldness(work)),
        max_output_tokens: getMaxOutputTokens()
      };
      payload = await fetchAiJson(`${config.baseUrl}/responses`, apiKey, requestBody, controller.signal);
      text = extractResponseText(payload);
    }

    const storyBible = normalizeStoryBible(extractJsonObject(text));
    const quality = validateStoryBibleQuality(work, storyBible);
    if (!quality.ok) {
      const error = new Error(`生成内容太泛：${quality.issues.join("；")}。请补充简介细节或重新生成。`);
      error.status = 422;
      throw error;
    }

    return {
      storyBible,
      model,
      provider: config.provider,
      endpoint: config.endpoint,
      fallback: false
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getModeInstruction(mode) {
  const modes = {
    continue: "续写当前章节。默认只输出可直接插入章节的小说正文，不要输出写作方案、分析、说明或标题；当前章节为空时，按当前章节标题和匹配章纲直接写开头。",
    polish: "润色文本。默认只输出润色后的正文，不要输出润色方案；不得改变剧情事实、人物关系、原作设定和叙事视角。",
    expand: "扩写文本。默认只输出扩写后的正文，不要输出扩写方案；增加动作、环境、心理、对话和冲突细节，且必须服务当前章纲。",
    shorten: "缩写文本。只输出压缩后的正文，保留关键事实、人物语气、冲突与叙事视角，删除重复解释和不推动情节的描写。",
    outline: "基于设定库扩展或细化章节大纲。只输出可用大纲，不要重新生成无关主线，要承接已有世界观、人物、势力和章节规划。",
    brainstorm: "基于设定库给出可直接采用的剧情灵感，必须服务当前章节冲突和后续章纲。",
    title: "根据当前章节正文和章纲生成一个贴合剧情、有小说感的中文章节标题。只输出标题。",
    custom: "根据作者补充指令处理当前作品和章节。如果指令要求写正文，默认只输出可直接插入章节的小说正文。只有作者明确要求方案时，才输出方案。"
  };

  return modes[mode] || modes.custom;
}

function buildAiPrompt(body) {
  const work = body.work || {};
  const chapter = body.chapter || {};
  const mode = normalizeText(body.mode) || "continue";
  const selectedText = String(body.selectedText || "");
  const instruction = normalizeText(body.instruction);
  const currentContent = String(chapter.content || "");
  const targetText = selectedText || currentContent;
  const boldness = clampNumber(work.boldness, 0, 100, 50);
  const storyBible = normalizeStoryBible(work.storyBible);
  const storyBibleSummary = compactStoryBible(storyBible);
  const chapterPlanMatch = findRelevantChapterPlan(storyBible.chapterPlan, chapter.title);
  const canonPolicy = getCanonPolicy(work);
  const structuredContinuity = body.continuityContext ? continuityContextText(body.continuityContext) : "暂无结构化事实；仍须遵守设定库。";
  const rewriteIssues = Array.isArray(body.rewriteIssues) ? body.rewriteIssues : [];
  const authorWantsPlan = /方案|思路|分析|计划|解释/.test(instruction);
  const outputRule = mode === "title"
    ? "输出要求：只输出一个简体中文章节标题，8到16个字，不要引号、序号、解释或列表。"
    : authorWantsPlan
      ? "输出要求：作者明确要求方案时，可以先给简短方案；但如果包含正文，请把正文放在【正文草稿】后面。"
      : [
          "输出要求：只输出最终可用内容。",
          "续写、扩写、按指令写正文时，只输出小说正文，不要输出【本次写作方案】、【正文草稿】、分析、说明、列表或写作建议。",
          "润色时只输出润色后的正文。",
          "大纲和灵感按钮可以输出结构化条目，但不要夹杂与写作无关的解释。",
          "不得输出免责声明；不得脱离设定库、当前章节标题和匹配章纲。"
        ].join("\n");

  return [
    `任务：${getModeInstruction(mode)}`,
    "",
    "题材策略：",
    canonPolicy,
    "",
    "作品信息：",
    `- 标题：${work.title || "未命名作品"}`,
    `- 类型：${work.genre || "原创"}`,
    `- 状态：${work.status || "draft"}`,
    `- 标签：${Array.isArray(work.tags) ? work.tags.join("、") : ""}`,
    `- 一句话梗概：${work.premise || ""}`,
    `- 大胆程度：${boldness}/100，${getBoldnessLabel(boldness)}`,
    "",
    "设定库摘要：",
    storyBibleSummary || "暂无设定库。请严格依据作品梗概和当前章节，不要擅自创造过多新设定。",
    "",
    "结构化连续性约束：",
    structuredContinuity,
    ...(rewriteIssues.length ? ["", "上一版必须修复的问题：", ...rewriteIssues.map((item) => `- ${item.message}`)] : []),
    "",
    "当前应推进的章节规划：",
    chapterPlanMatch || "未匹配到具体章纲。请按当前章节标题和作品主线合理推进，不要改写主线方向。",
    "",
    "当前章节：",
    `- 标题：${chapter.title || "未命名章节"}`,
    `- 状态：${chapter.status || "draft"}`,
    `- 章节备注：${chapter.notes || ""}`,
    "",
    selectedText ? "作者选中文本：" : "当前章节正文：",
    limitText(targetText, 9000),
    "",
    "作者补充指令：",
    instruction || "无",
    "",
    "写作约束：",
    "- 本次生成开始前，必须重新阅读并遵守上方的设定库摘要、世界观、人物设定、故事大纲、章节规划和连续性提醒；不得只依赖上一轮对话记忆。",
    "- 右侧工具栏生成内容必须参考设定库，尤其要使用世界观、人物设定、势力/组织、主线冲突、章节规划和连续性提醒。",
    "- 当前章节为空时，不要说“可以怎么写”，要直接写本章开场正文。",
    "- 如果作者要求写第一章、写开头、写战斗或写某个场景，直接按要求写小说正文，不要只分析。",
    "- 续写、扩写、按指令写正文时，默认生成约1800到2200个中文字符；如果作者另有字数要求，以作者要求为准。",
    "- 正文要写足场景推进、动作、对话、心理和结尾钩子，不要用提纲式短段落凑数。",
    "- 对同人作品，必须贴合原作世界和角色关系，但不要照搬原作大段文本。",
    "- 大胆程度只影响反转、爽点和新奇度，不允许推翻原作核心设定或作者设定。",
    "",
    outputRule
  ].join("\n");
}

function pickFreshLocalDraft(sourceText, drafts) {
  const source = String(sourceText || "");
  return drafts.find((draft) => draft && !source.includes(draft)) || drafts[source.length % drafts.length] || "";
}

function buildLocalAiDraft(body) {
  const work = body.work || {};
  const chapter = body.chapter || {};
  const mode = normalizeText(body.mode) || "continue";
  const instruction = normalizeText(body.instruction);
  const selectedText = String(body.selectedText || "").trim();
  const sourceText = selectedText || String(chapter.content || "").trim();
  const storyBible = normalizeStoryBible(work.storyBible);
  const chapterTitle = chapter.title || "当前章节";
  const chapterPlanMatch = findRelevantChapterPlan(storyBible.chapterPlan, chapterTitle);

  if (isSuperSeminarySystemFanfic(work)) {
    if (mode === "title") {
      return /第一章|开头/.test(chapterTitle) ? "我叫葛小伦！！！" : "银河之力的新变量";
    }

    if (mode === "outline") {
      return [
        "第一卷：卢小鱼魂穿葛小伦，系统激活，主角先稳住身份，再进入雄兵连，用系统训练弥补前期短板。",
        "第二卷：饕餮压力出现，主角用原作信息差改变局部战局，同时引起杜卡奥、天使和卡尔的注意。",
        "第三卷：虚空线索提前浮现，主角发现剧情已经偏移，必须把银河之力、系统奖励和雄兵连羁绊整合成真正战力。",
        chapterPlanMatch ? `当前章节承接：${chapterPlanMatch}` : ""
      ].filter(Boolean).join("\n");
    }

    if (mode === "brainstorm") {
      return [
        "1. 系统任务要求卢小鱼在不暴露穿越身份的情况下加入雄兵连。",
        "2. 第一次训练中，他用战斗直觉避开原作尴尬局面，却让蕾娜和蔷薇察觉异常。",
        "3. 饕餮小规模试探提前出现，主角用剧情信息差救下队友，但卡尔记录到银河之力异常波动。",
        "4. 系统奖励越强，未来偏移越大，主角逐渐不能完全依赖原作记忆。"
      ].join("\n");
    }

    if (mode === "polish" && sourceText) {
      return sourceText.replace(/[ \t]+/g, "").replace(/\n{3,}/g, "\n\n").trim();
    }

    return [
      "卢小鱼醒来的第一反应，是觉得自己的脑袋像被一辆卡车反复碾过。",
      "",
      "他猛地坐起身，陌生的房间、陌生的手臂、陌生到离谱的力量感，一起砸进他的意识里。镜子里的那张脸让他整个人僵在原地。",
      "",
      "“葛小伦？”",
      "",
      "这三个字刚出口，脑海里忽然响起一声冰冷的提示音。",
      "",
      "【银河之力适配完成。】",
      "【宿主卢小鱼，系统绑定成功。】",
      "【主线任务一：在三天内接触超神学院，加入雄兵连。】",
      "",
      "卢小鱼盯着镜子，喉结滚了滚。上一秒他还在车灯刺眼的路口，下一秒就成了自己看过的动漫里的葛小伦。更要命的是，他很清楚这个世界接下来会发生什么。",
      "",
      "饕餮会来，天使会来，恶魔会来，卡尔和虚空也会在更远的地方盯着地球。",
      "",
      "他低头握拳，指节传来沉闷的爆响。身体里像藏着一台尚未启动的恒星引擎，沉重、陌生，却真实得让人发慌。",
      "",
      "系统再次弹出提示。",
      "",
      "【新手奖励：基础体能修正。】",
      "【失败惩罚：主线锁定，银河之力开发进度下降。】",
      "",
      "卢小鱼沉默了几秒，忽然笑了一声。",
      "",
      "“行吧。”他看着镜子里的葛小伦，声音还有些发颤，却比刚醒来时稳了许多，“既然都穿成银河之力了，总不能还按原来的剧本挨打吧？”"
    ].join("\n");
  }

  if (mode === "title") {
    return "新的转折";
  }

  if (mode === "polish" && sourceText) {
    return sourceText.replace(/[ \t]+/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  if (mode === "shorten" && sourceText) {
    const sentences = sourceText.split(/(?<=[。！？!?])/u).filter(Boolean);
    return sentences.filter((_sentence, index) => index % 2 === 0 || sentences.length < 4).join("").trim();
  }

  const protagonist = normalizeText(storyBible.characters).split(/[：:\n]/)[0] || "主角";
  const focus = limitText(instruction || chapterPlanMatch || work.premise || storyBible.conflict || "眼前正在发生的变化", 72);
  const continuationDrafts = [
    `${protagonist}没有马上作出决定，而是重新核对手中的线索。关于“${focus}”的细节里，有一处此前被忽略的矛盾正变得越来越清晰。`,
    `门外突然传来的动静打断了${protagonist}的思考。新的变化没有给人留下准备时间，也迫使他把“${focus}”从猜测变成下一步必须验证的行动。`,
    `${protagonist}刚把现有线索串联起来，局面便出现了新的偏差。原本安全的选择开始显露代价，而“${focus}”背后的压力也第一次真正落到现实中。`,
    `事情没有沿着预想的方向发展。${protagonist}意识到，只有主动追查“${focus}”，才可能在下一次变化到来之前拿回一点主动权。`
  ];

  if (mode === "expand" && sourceText) {
    return `${sourceText}\n\n${pickFreshLocalDraft(sourceText, continuationDrafts)}`;
  }

  if (mode === "custom" && selectedText) {
    return pickFreshLocalDraft(sourceText, continuationDrafts);
  }

  return pickFreshLocalDraft(sourceText, continuationDrafts);
}

function buildTestAiResult(body) {
  return {
    text: buildLocalAiDraft(body),
    model: "测试模型",
    provider: "test",
    endpoint: "test",
    fallback: false,
    warning: ""
  };
}

function buildTestStoryBible(work) {
  const result = buildLocalStoryBible(work);
  return {
    ...result,
    model: "测试模型",
    provider: "test",
    endpoint: "test",
    fallback: false,
    warning: ""
  };
}

function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (url.pathname.startsWith("/api")) {
        await handleApi(req, res, url);
        return;
      }

      await serveStatic(req, res, url);
    } catch (error) {
      if (error.message === "REQUEST_TOO_LARGE") {
        sendError(res, 413, "Request body is too large");
        return;
      }

      if (error.message === "BACKUP_TOO_LARGE") {
        sendError(res, 413, "备份文件超过 50MB，无法恢复。请拆分作品或清理过大的封面后重试。");
        return;
      }

      if (error instanceof SyntaxError) {
        sendError(res, 400, "Invalid JSON body");
        return;
      }

      if (error.name === "AbortError") {
        sendError(res, 504, "AI 请求超时。请检查网络、代理或 OpenAI API 地址。");
        return;
      }

      const networkMessage = getNetworkErrorMessage(error);
      if (networkMessage) {
        sendError(res, 502, networkMessage);
        return;
      }

      if (error.status) {
        sendError(res, error.status, error.message);
        return;
      }

      console.error(error);
      sendError(res, 500, "Internal server error");
    }
  });
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`墨台写作平台已启动：http://127.0.0.1:${PORT}`);
  });
}

module.exports = {
  buildAiPrompt,
  buildImagePrompt,
  buildStoryBiblePrompt,
  createAppServer
};
