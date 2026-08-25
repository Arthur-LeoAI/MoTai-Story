const MAIN_VIEWS = new Set(["home", "create", "write", "bible", "characters", "world", "timeline", "cover", "work", "settings"]);
const WORKSPACE_STATE_KEY = "motai.workspaceState";
const HOME_ARTS = {
  light: {
    image: "/assets/home/dawn-studio.png",
    alt: "晨光中的书案、手稿与毛笔",
    kicker: "晨光书案",
    title: "让灵感，从第一行开始",
    prompt: "晨光中的中式书案、翻开的小说手稿、墨水与钢笔、温暖日光、安静的书架，竖版高级编辑主视觉，不要文字水印"
  },
  dark: {
    image: "/assets/home/ink-window.png",
    alt: "月光雨夜中的墨色书案",
    kicker: "墨夜成章",
    title: "在安静里，把故事写深",
    prompt: "雨夜月光下的中式书房、黑色漆木书案、打开的手稿、砚台和毛笔、克制的水墨氛围，竖版高级编辑主视觉，不要文字水印"
  },
  midnight: {
    image: "/assets/home/star-observatory.png",
    alt: "星空观测室中的手稿与星图",
    kicker: "星图写作室",
    title: "让世界观，向更远处展开",
    prompt: "深蓝星空观测写作室、圆形舷窗、星图投影、手稿和钢笔、文学感未来书房，竖版高级编辑主视觉，不要文字水印"
  },
  paper: {
    image: "/assets/home/amber-study.png",
    alt: "暖灯映照的深夜书房",
    kicker: "暖灯夜读",
    title: "把想写的故事，慢慢写完",
    prompt: "暖色台灯下的深夜中式书房、手写小说稿、茶杯、书籍和雨窗、琥珀色光影，竖版高级编辑主视觉，不要文字水印"
  }
};

function loadWorkspaceState() {
  const fallback = {
    workId: "",
    chapterId: "",
    mainView: "home",
    previewMode: false
  };

  try {
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_STATE_KEY) || "{}");
    return {
      workId: typeof saved.workId === "string" ? saved.workId : "",
      chapterId: typeof saved.chapterId === "string" ? saved.chapterId : "",
      mainView: MAIN_VIEWS.has(saved.mainView) ? saved.mainView : fallback.mainView,
      previewMode: Boolean(saved.previewMode)
    };
  } catch {
    return fallback;
  }
}

const restoredWorkspace = loadWorkspaceState();

const state = {
  works: [],
  currentWork: null,
  currentChapterId: null,
  mainView: restoredWorkspace.mainView,
  saveTimer: null,
  workSaveTimer: null,
  previewMode: restoredWorkspace.previewMode,
  inspectorTab: localStorage.getItem("motai.inspectorTab") || "write",
  search: "",
  aiConfigured: false,
  aiConfig: null,
  aiBusy: false,
  aiOutputInsertable: false,
  editorUndoStack: [],
  editorRedoStack: [],
  lastEditorValue: "",
  lastHistoryAt: 0,
  suppressHistory: false,
  toolbarPrefs: null,
  workLoadVersion: 0,
  restoredWorkspace,
  uiPreferencesReady: false,
  uiPreferencesTimer: null,
  wallpaper: null,
  storyBibleQuality: null,
  structuredActionLocked: false
};

const els = {
  studio: document.querySelector(".studio"),
  homeScreen: document.querySelector("#homeScreen"),
  homeArtImage: document.querySelector("#homeArtImage"),
  homeArtKicker: document.querySelector("#homeArtKicker"),
  homeArtTitle: document.querySelector("#homeArtTitle"),
  homeArtGenerateButton: document.querySelector("#homeArtGenerateButton"),
  homeArtResetButton: document.querySelector("#homeArtResetButton"),
  mainWorkspace: document.querySelector("#mainWorkspace"),
  mainViewButtons: document.querySelectorAll("[data-main-view]"),
  workList: document.querySelector("#workList"),
  chapterList: document.querySelector("#chapterList"),
  workSearch: document.querySelector("#workSearch"),
  newWorkButton: document.querySelector("#newWorkButton"),
  newWorkModal: document.querySelector("#newWorkModal"),
  newWorkForm: document.querySelector("#newWorkForm"),
  newWorkTitle: document.querySelector("#newWorkTitle"),
  newWorkAuthor: document.querySelector("#newWorkAuthor"),
  newWorkGenre: document.querySelector("#newWorkGenre"),
  newWorkChapterTitle: document.querySelector("#newWorkChapterTitle"),
  newWorkTarget: document.querySelector("#newWorkTarget"),
  newWorkTags: document.querySelector("#newWorkTags"),
  newWorkPremise: document.querySelector("#newWorkPremise"),
  closeNewWorkButton: document.querySelector("#closeNewWorkButton"),
  cancelNewWorkButton: document.querySelector("#cancelNewWorkButton"),
  createWorkSubmit: document.querySelector("#createWorkSubmit"),
  workTitleInput: document.querySelector("#workTitleInput"),
  workGenreLabel: document.querySelector("#workGenreLabel"),
  saveState: document.querySelector("#saveState"),
  exportButton: document.querySelector("#exportButton"),
  exportFormatSelect: document.querySelector("#exportFormatSelect"),
  exportPicker: document.querySelector("#exportPicker"),
  exportMenu: document.querySelector("#exportMenu"),
  exportOptionButtons: document.querySelectorAll("[data-export-format]"),
  exportButtonLabel: document.querySelector("#exportButtonLabel"),
  exportToggleButton: document.querySelector("#exportToggleButton"),
  themePicker: document.querySelector("#themePicker"),
  themeMenu: document.querySelector("#themeMenu"),
  themeOptionButtons: document.querySelectorAll("[data-theme-option]"),
  themeButtonIcon: document.querySelector("#themeButtonIcon"),
  themeButtonLabel: document.querySelector("#themeButtonLabel"),
  themeToggleButton: document.querySelector("#themeToggleButton"),
  wallpaperPicker: document.querySelector("#wallpaperPicker"),
  wallpaperMenu: document.querySelector("#wallpaperMenu"),
  wallpaperToggleButton: document.querySelector("#wallpaperToggleButton"),
  wallpaperCloseButton: document.querySelector("#wallpaperCloseButton"),
  wallpaperBuiltinChoices: document.querySelector("#wallpaperBuiltinChoices"),
  wallpaperCustomChoices: document.querySelector("#wallpaperCustomChoices"),
  wallpaperOpacityInput: document.querySelector("#wallpaperOpacityInput"),
  wallpaperOpacityValue: document.querySelector("#wallpaperOpacityValue"),
  wallpaperPromptInput: document.querySelector("#wallpaperPromptInput"),
  wallpaperGenerateButton: document.querySelector("#wallpaperGenerateButton"),
  wallpaperUploadButton: document.querySelector("#wallpaperUploadButton"),
  wallpaperUploadInput: document.querySelector("#wallpaperUploadInput"),
  shutdownButton: document.querySelector("#shutdownButton"),
  addChapterButton: document.querySelector("#addChapterButton"),
  chapterTitleInput: document.querySelector("#chapterTitleInput"),
  chapterStatusSelect: document.querySelector("#chapterStatusSelect"),
  writeModeButton: document.querySelector("#writeModeButton"),
  previewModeButton: document.querySelector("#previewModeButton"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  formatChapterButton: document.querySelector("#formatChapterButton"),
  insertIllustrationButton: document.querySelector("#insertIllustrationButton"),
  generateTitleButton: document.querySelector("#generateTitleButton"),
  chapterContentInput: document.querySelector("#chapterContentInput"),
  chapterPreview: document.querySelector("#chapterPreview"),
  totalCharacters: document.querySelector("#totalCharacters"),
  chapterCharacters: document.querySelector("#chapterCharacters"),
  readingTime: document.querySelector("#readingTime"),
  progressLabel: document.querySelector("#progressLabel"),
  progressFill: document.querySelector("#progressFill"),
  genreInput: document.querySelector("#genreInput"),
  authorInput: document.querySelector("#authorInput"),
  workStatusSelect: document.querySelector("#workStatusSelect"),
  targetInput: document.querySelector("#targetInput"),
  boldnessInput: document.querySelector("#boldnessInput"),
  boldnessValue: document.querySelector("#boldnessValue"),
  storyBibleStatus: document.querySelector("#storyBibleStatus"),
  storyQualityCheckButton: document.querySelector("#storyQualityCheckButton"),
  storyQualitySummary: document.querySelector("#storyQualitySummary"),
  storyQualityChecks: document.querySelector("#storyQualityChecks"),
  storyQualityIssues: document.querySelector("#storyQualityIssues"),
  storyRoadmapCheckButton: document.querySelector("#storyRoadmapCheckButton"),
  storyRoadmapSummary: document.querySelector("#storyRoadmapSummary"),
  storyRoadmapSteps: document.querySelector("#storyRoadmapSteps"),
  storyBibleInputs: document.querySelectorAll("[data-story-field]"),
  characterMap: document.querySelector("#characterMap"),
  characterCardList: document.querySelector("#characterCardList"),
  relationshipCardList: document.querySelector("#relationshipCardList"),
  addCharacterCardButton: document.querySelector("#addCharacterCardButton"),
  addRelationshipCardButton: document.querySelector("#addRelationshipCardButton"),
  chapterBoard: document.querySelector("#chapterBoard"),
  chapterBoardSummary: document.querySelector("#chapterBoardSummary"),
  chapterPlanningLabel: document.querySelector("#chapterPlanningLabel"),
  chapterGoalInput: document.querySelector("#chapterGoalInput"),
  chapterSceneInput: document.querySelector("#chapterSceneInput"),
  chapterCharactersInput: document.querySelector("#chapterCharactersInput"),
  chapterConflictInput: document.querySelector("#chapterConflictInput"),
  chapterHookInput: document.querySelector("#chapterHookInput"),
  tagsInput: document.querySelector("#tagsInput"),
  premiseInput: document.querySelector("#premiseInput"),
  premiseGenerateButton: document.querySelector("#premiseGenerateButton"),
  backupExportButton: document.querySelector("#backupExportButton"),
  backupRestoreButton: document.querySelector("#backupRestoreButton"),
  backupRestoreInput: document.querySelector("#backupRestoreInput"),
  backupNote: document.querySelector("#backupNote"),
  coverImage: document.querySelector("#coverImage"),
  coverStatus: document.querySelector("#coverStatus"),
  coverPromptInput: document.querySelector("#coverPromptInput"),
  coverLoglineInput: document.querySelector("#coverLoglineInput"),
  coverPaletteSelect: document.querySelector("#coverPaletteSelect"),
  coverTitleAlignSelect: document.querySelector("#coverTitleAlignSelect"),
  coverShowTitleInput: document.querySelector("#coverShowTitleInput"),
  coverShowMetadataInput: document.querySelector("#coverShowMetadataInput"),
  coverShowLoglineInput: document.querySelector("#coverShowLoglineInput"),
  coverShowAuthorInput: document.querySelector("#coverShowAuthorInput"),
  coverRebuildButton: document.querySelector("#coverRebuildButton"),
  coverUploadInput: document.querySelector("#coverUploadInput"),
  coverUploadButton: document.querySelector("#coverUploadButton"),
  coverGenerateButton: document.querySelector("#coverGenerateButton"),
  quickCoverGenerateButton: document.querySelector("#quickCoverGenerateButton"),
  coverHistoryList: document.querySelector("#coverHistoryList"),
  coverHistoryCount: document.querySelector("#coverHistoryCount"),
  quickCoverHistory: document.querySelector("#quickCoverHistory"),
  quickCoverNote: document.querySelector("#quickCoverNote"),
  chapterImageModal: document.querySelector("#chapterImageModal"),
  chapterImageForm: document.querySelector("#chapterImageForm"),
  closeChapterImageButton: document.querySelector("#closeChapterImageButton"),
  chapterImageCaptionInput: document.querySelector("#chapterImageCaptionInput"),
  chapterImagePromptInput: document.querySelector("#chapterImagePromptInput"),
  chapterImageUploadInput: document.querySelector("#chapterImageUploadInput"),
  chapterImageUploadButton: document.querySelector("#chapterImageUploadButton"),
  chapterImageGenerateButton: document.querySelector("#chapterImageGenerateButton"),
  chapterImageNote: document.querySelector("#chapterImageNote"),
  inspector: document.querySelector(".inspector"),
  quickToolbar: document.querySelector("#quickToolbar"),
  toolbarCustomizeButton: document.querySelector("#toolbarCustomizeButton"),
  toolbarCustomizePanel: document.querySelector("#toolbarCustomizePanel"),
  toolbarToggles: document.querySelectorAll("[data-toolbar-toggle]"),
  toolbarCards: document.querySelectorAll("[data-toolbar-card]"),
  toolbarActions: document.querySelectorAll("[data-toolbar-action]"),
  openMainPanelButtons: document.querySelectorAll("[data-open-main-panel]"),
  mainPanelTitle: document.querySelector("#mainPanelTitle"),
  mainPanelCloseButton: document.querySelector("#mainPanelCloseButton"),
  inspectorPanels: document.querySelectorAll("[data-inspector-panel]"),
  aiStatus: document.querySelector("#aiStatus"),
  aiWritePane: document.querySelector("#aiWritePane"),
  aiSettingsPane: document.querySelector("#aiSettingsPane"),
  aiInstructionInput: document.querySelector("#aiInstructionInput"),
  aiOutput: document.querySelector("#aiOutput"),
  aiInsertButton: document.querySelector("#aiInsertButton"),
  aiActionButtons: document.querySelectorAll("[data-ai-mode]"),
  aiProviderSelect: document.querySelector("#aiProviderSelect"),
  aiKeyInput: document.querySelector("#aiKeyInput"),
  aiBaseUrlInput: document.querySelector("#aiBaseUrlInput"),
  aiModelInput: document.querySelector("#aiModelInput"),
  aiEndpointSelect: document.querySelector("#aiEndpointSelect"),
  aiMaxTokensInput: document.querySelector("#aiMaxTokensInput"),
  aiTimeoutInput: document.querySelector("#aiTimeoutInput"),
  imageKeyInput: document.querySelector("#imageKeyInput"),
  imageBaseUrlInput: document.querySelector("#imageBaseUrlInput"),
  imageModelInput: document.querySelector("#imageModelInput"),
  imageTimeoutInput: document.querySelector("#imageTimeoutInput"),
  aiProxyInput: document.querySelector("#aiProxyInput"),
  aiFallbackInput: document.querySelector("#aiFallbackInput"),
  aiSaveConfigButton: document.querySelector("#aiSaveConfigButton"),
  aiTestConfigButton: document.querySelector("#aiTestConfigButton"),
  aiConfigNote: document.querySelector("#aiConfigNote"),
  toast: document.querySelector("#toast")
};

const STATUS_LABELS = {
  draft: "草稿",
  editing: "修订",
  done: "完成",
  serializing: "连载",
  paused: "暂停",
  finished: "完结"
};

const AI_PROVIDER_HINTS = {
  openai: "OpenAI 推荐 Responses。",
  deepseek: "DeepSeek 使用 Chat 兼容接口。",
  moonshot: "Kimi 使用 Chat 兼容接口。",
  zhipu: "智谱使用 Chat 兼容接口。",
  custom: "自定义接口请填写 Base URL、模型和类型。",
  local: "本地备用不需要联网。"
};

const AUTO_INSERT_AI_MODES = new Set(["continue", "custom"]);

const MAIN_PANEL_TITLES = {
  write: "写作工作台",
  bible: "设定库工作台",
  characters: "人物档案",
  world: "世界观",
  timeline: "时间线",
  cover: "封面工坊",
  work: "作品信息工作台",
  settings: "接口配置工作台"
};

const DEFAULT_TOOLBAR_PREFS = {
  ai: true,
  bible: true,
  work: true,
  cover: true,
  settings: true
};

const STORY_BIBLE_FIELDS = [
  "logline",
  "theme",
  "tone",
  "genrePositioning",
  "worldview",
  "rules",
  "era",
  "characters",
  "relationships",
  "factions",
  "locations",
  "conflict",
  "antagonistPressure",
  "foreshadowing",
  "continuityNotes",
  "outline",
  "chapterPlan"
];

function emptyStoryBible() {
  return STORY_BIBLE_FIELDS.reduce((draft, field) => {
    draft[field] = "";
    return draft;
  }, {});
}

function normalizeStoryBible(value) {
  return {
    ...emptyStoryBible(),
    ...(value && typeof value === "object" ? value : {})
  };
}

function getBoldnessLabel(value) {
  const number = Number(value) || 50;
  if (number <= 30) {
    return "稳妥";
  }
  if (number >= 71) {
    return "大胆";
  }
  return "平衡";
}

function currentChapter() {
  if (!state.currentWork) {
    return null;
  }
  return state.currentWork.chapters.find((chapter) => chapter.id === state.currentChapterId) || state.currentWork.chapters[0] || null;
}

function countCharacters(text) {
  return String(text || "").replace(/\s/g, "").length;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function splitStoryLines(text) {
  return String(text || "")
    .split(/\n+|(?<=[。；;])\s*/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitStructuredLines(text) {
  return String(text || "")
    .split(/\r?\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inferRoleGroup(name, detail) {
  const source = `${name} ${detail}`;
  if (/主角|主人公|第一视角|视角人物|穿越者|转生者/.test(source)) {
    return "core";
  }
  if (/系统|任务助手|智能体|面板|契约/.test(source)) {
    return "system";
  }
  if (/反派|敌对|敌人|威胁|追杀|阻止|对立|阴谋/.test(source)) {
    return "enemy";
  }
  if (/队友|盟友|同伴|战友|伙伴|朋友|闺蜜|兄弟|导师|组织成员|保护/.test(source)) {
    return "ally";
  }
  return "other";
}

function normalizeCharacterCandidate(value) {
  return String(value || "")
    .replace(/^[\s\-*•·、0-9.]+/u, "")
    .replace(/^(角色|人物|主角|主要人物|核心人物|配角|队友|反派|导师|姓名|名称)\s*/u, "")
    .replace(/等.*$/u, "")
    .replace(/[（(].*?[）)]/gu, "")
    .trim();
}

function isLikelyCharacterName(value) {
  const name = normalizeCharacterCandidate(value);
  if (!name || name.length < 2 || name.length > 16) {
    return false;
  }
  if (name.includes("/") || name.includes("、")) {
    return name
      .split(/[、/]/u)
      .map((part) => part.trim())
      .every((part) => part.length >= 2 && part.length <= 5);
  }
  if (/[是为会把让使从在对和与及]|身份|目标|弱点|成长|表现|设定|关系|队友|反派|组织|势力|文明|学院|规则|压力|冲突|任务|世界|剧情|主线|能力/.test(name)) {
    return false;
  }
  return /^[\u4e00-\u9fa5A-Za-z0-9·]{2,8}$/u.test(name);
}

function extractCharacterName(line) {
  const match = line.match(/^\s*(?:[-*•·、0-9.]+\s*)?(?:角色|人物|姓名|名称)?\s*([^：:\n]{2,24})[：:]/u);
  if (!match) {
    return "";
  }
  const name = normalizeCharacterCandidate(match[1]);
  return isLikelyCharacterName(name) ? name : "";
}

function detailForName(name, text) {
  const line = splitStoryLines(text).find((item) => item.includes(name));
  if (!line) {
    return "";
  }
  return line.replace(name, "").replace(/^[：:，,。；;\s]+/u, "").trim();
}

function extractCharacters(text, relationshipsText) {
  const map = new Map();
  const lines = splitStoryLines(text);

  const addCharacter = (name, detail, sourceLine) => {
    const normalized = normalizeCharacterCandidate(name);
    if (!isLikelyCharacterName(normalized)) {
      return;
    }
    const existing = map.get(normalized);
    map.set(normalized, {
      name: normalized,
      detail: existing?.detail || detail || "",
      group: inferRoleGroup(normalized, `${detail || ""} ${sourceLine || ""}`)
    });
  };

  lines.forEach((line) => {
    const name = extractCharacterName(line);
    if (name) {
      addCharacter(name, detailForName(name, line), line);
      return;
    }

    const listMatch = line.match(/^\s*([^：:\n]{2,16})[：:]\s*(.+)$/u);
    if (!listMatch || !/(队友|盟友|反派|敌人|天使|恶魔|系统|学院|组织|势力|角色|人物)/.test(listMatch[1])) {
      return;
    }
    listMatch[2]
      .split(/[、,，/]/u)
      .map(normalizeCharacterCandidate)
      .forEach((candidate) => addCharacter(candidate, detailForName(candidate, line), line));
  });

  return [...map.values()].slice(0, 18);
}

function relationshipLabel(line) {
  if (/恋人|前任|喜欢|爱慕|暧昧|复合/.test(line)) {
    return "情感";
  }
  if (/敌|对抗|冲突|威胁|阻止|猎杀/.test(line)) {
    return "敌对";
  }
  if (/利用|操控|试探|观察|盯上/.test(line)) {
    return "试探";
  }
  if (/守护|保护|护卫/.test(line)) {
    return "守护";
  }
  if (/训练|培养|导师|教导/.test(line)) {
    return "训练";
  }
  if (/盟友|队友|战友|合作|信任/.test(line)) {
    return "盟友";
  }
  if (/怀疑|隐瞒|秘密/.test(line)) {
    return "怀疑";
  }
  return "关联";
}

function extractRelationships(text, characters) {
  const names = characters.map((item) => item.name);
  const links = [];

  splitStoryLines(text).forEach((line) => {
    const hits = names.filter((name) => line.includes(name));
    if (hits.length >= 2) {
      links.push({
        from: hits[0],
        to: hits[1],
        label: relationshipLabel(line)
      });
    }
  });

  if (!links.length && characters.length > 1) {
    const core = characters.find((item) => item.group === "core") || characters[0];
    characters
      .filter((item) => item.name !== core.name)
      .slice(0, 8)
      .forEach((item) => {
        links.push({
          from: core.name,
          to: item.name,
          label: relationshipLabel(`${core.detail} ${item.detail}`)
        });
      });
  }

  return links.slice(0, 12);
}

function shortDetail(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) {
    return "待补充目标、立场和成长线";
  }
  return value.length > 54 ? `${value.slice(0, 54)}…` : value;
}

function groupBadge(group) {
  return {
    core: "主",
    ally: "友",
    enemy: "敌",
    system: "系",
    other: "角"
  }[group] || "角";
}

function groupLabel(group) {
  return {
    core: "核心",
    ally: "盟友",
    enemy: "敌对",
    system: "系统",
    other: "其他"
  }[group] || "其他";
}

function layoutCharacterGraph(characters, links) {
  const core = characters.find((item) => item.group === "core") || characters[0];
  const buckets = {
    ally: characters.filter((item) => item.group === "ally" && item.name !== core.name),
    enemy: characters.filter((item) => item.group === "enemy" && item.name !== core.name),
    system: characters.filter((item) => item.group === "system" && item.name !== core.name),
    other: characters.filter((item) => item.group === "other" && item.name !== core.name)
  };
  const nodes = [{ ...core, x: 500, y: 260 }];
  const place = (items, x, startY, gap) => {
    items.slice(0, 4).forEach((item, index) => {
      nodes.push({ ...item, x, y: startY + index * gap });
    });
  };

  place(buckets.ally, 210, 150, 86);
  place(buckets.enemy, 800, 150, 86);
  place(buckets.system, 500, 86, 74);
  place(buckets.other, 650, 420, 74);

  const known = new Set(nodes.map((item) => item.name));
  const visibleLinks = links
    .filter((link) => known.has(link.from) && known.has(link.to) && link.from !== link.to)
    .slice(0, 14);

  return { nodes, links: visibleLinks, core };
}

function renderCharacterMap(storyBible) {
  if (!els.characterMap) {
    return;
  }

  const data = normalizeStoryBible(storyBible);
  const characters = extractCharacters(data.characters, data.relationships);
  const links = extractRelationships(data.relationships, characters);

  if (!characters.length) {
    els.characterMap.innerHTML = `
      <div class="character-map-empty">
        <strong>暂无人物关系图</strong>
        <span>在下方填写人物设定和关系网后，这里会自动生成简洁看板。</span>
      </div>
    `;
    return;
  }

  const core = characters.find((item) => item.group === "core") || characters[0];
  const graph = layoutCharacterGraph(characters, links);
  const positionByName = new Map(graph.nodes.map((item) => [item.name, item]));
  const linkSvg = graph.links.map((link, index) => {
    const from = positionByName.get(link.from);
    const to = positionByName.get(link.to);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const startX = from.x + (dx / distance) * 72;
    const startY = from.y + (dy / distance) * 28;
    const endX = to.x - (dx / distance) * 76;
    const endY = to.y - (dy / distance) * 28;
    const curve = Math.min(90, Math.max(-90, (index % 2 === 0 ? 1 : -1) * Math.abs(dy) * 0.22));
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2 - curve * 0.18;

    return `
      <g class="graph-link">
        <path d="M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${midX.toFixed(1)} ${(midY - curve).toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}" marker-end="url(#relationArrow)" />
        <rect x="${(midX - 25).toFixed(1)}" y="${(midY - 13).toFixed(1)}" width="50" height="24" rx="12"></rect>
        <text x="${midX.toFixed(1)}" y="${(midY + 4).toFixed(1)}">${escapeHtml(link.label)}</text>
      </g>
    `;
  }).join("");

  const nodeHtml = graph.nodes.map((item) => `
    <article class="graph-node ${item.group}${item.name === core.name ? " is-core" : ""}" style="left:${(item.x / 10).toFixed(2)}%; top:${(item.y / 5.2).toFixed(2)}%;">
      <span class="graph-avatar" aria-hidden="true">${escapeHtml(groupBadge(item.group))}</span>
      <strong>${escapeHtml(item.name)}</strong>
      <small>${escapeHtml(groupLabel(item.group))}</small>
    </article>
  `).join("");

  els.characterMap.innerHTML = `
    <div class="character-map-board">
      <div class="character-map-title">
        <div>
          <strong>主要人物与关系网</strong>
          <span>仅依据当前作品的人物设定与关系网</span>
        </div>
        <small>${characters.length} 人物 / ${links.length} 关系</small>
      </div>
      <div class="relationship-graph" role="img" aria-label="带箭头的人物关系图">
        <svg class="relationship-svg" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="relationArrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z"></path>
            </marker>
          </defs>
          ${linkSvg}
        </svg>
        ${nodeHtml}
        ${graph.links.length || characters.length <= 1 ? "" : `<div class="graph-empty-hint">关系网需要写成“甲 -> 乙：关系｜状态｜矛盾”，这里才会生成箭头。</div>`}
      </div>
    </div>
  `;
}

function debounce(fn, wait) {
  return (...args) => {
    window.clearTimeout(fn.timer);
    fn.timer = window.setTimeout(() => fn(...args), wait);
  };
}

function setSaveState(label) {
  els.saveState.textContent = label;
  const value = String(label || "");
  const stateName = value.includes("失败")
    ? "error"
    : value.includes("保存中")
      ? "saving"
      : value.includes("未保存")
        ? "dirty"
        : "saved";
  els.saveState.dataset.state = stateName;
}

function toast(message, tone = "") {
  els.toast.textContent = message;
  els.toast.dataset.tone = tone || (/失败|错误|超时|无法|请先/.test(String(message || "")) ? "error" : "success");
  els.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function addClickPulse(event) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const target = event.target.closest(".button, .icon-button, .tool-button, .segment, .main-nav-item, .theme-trigger");
  if (!target || target.disabled) {
    return;
  }

  const bounds = target.getBoundingClientRect();
  const pulse = document.createElement("span");
  pulse.className = "click-pulse";
  pulse.style.left = `${event.clientX - bounds.left}px`;
  pulse.style.top = `${event.clientY - bounds.top}px`;
  target.appendChild(pulse);
  pulse.addEventListener("animationend", () => pulse.remove(), { once: true });
}

const THEME_OPTIONS = {
  light: { label: "晨光", icon: "晨" },
  dark: { label: "深墨", icon: "墨" },
  midnight: { label: "夜航", icon: "夜" },
  paper: { label: "暖夜", icon: "暖" }
};

const EXPORT_FORMAT_OPTIONS = {
  markdown: "Markdown",
  txt: "TXT",
  html: "HTML",
  doc: "Word",
  pdf: "PDF"
};

const BUILTIN_WALLPAPERS = [
  { id: "dawn-desk", name: "晨光书案", theme: "light", image: "/assets/wallpapers/dawn-desk.png", description: "云墨、晨光与书案" },
  { id: "ink-moon", name: "深墨雨窗", theme: "dark", image: "/assets/wallpapers/ink-moon.png", description: "雨夜、砚台与月窗" },
  { id: "star-voyage", name: "夜航星图", theme: "midnight", image: "/assets/wallpapers/star-voyage.png", description: "星幕、卷轴与远航" },
  { id: "amber-study", name: "暖夜书房", theme: "paper", image: "/assets/wallpapers/amber-study.png", description: "暖灯、书架与夜读" }
];

const DEFAULT_WALLPAPER = {
  selectedId: "auto",
  opacity: 22,
  customWallpapers: []
};

function normalizeWallpaper(value) {
  const source = value && typeof value === "object" ? value : {};
  const customWallpapers = Array.isArray(source.customWallpapers)
    ? source.customWallpapers
      .filter((item) => item && typeof item === "object" && String(item.image || "").startsWith("/data/wallpapers/"))
      .map((item) => ({
        id: String(item.id || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 80),
        name: String(item.name || "自定义壁纸").slice(0, 80),
        image: String(item.image),
        theme: THEME_OPTIONS[item.theme] ? item.theme : "",
        source: "custom",
        workId: String(item.workId || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 80)
      }))
      .filter((item) => item.id)
      .slice(0, 12)
    : [];
  const selectedId = String(source.selectedId || "auto");
  const hasBuiltIn = BUILTIN_WALLPAPERS.some((item) => item.id === selectedId);
  const hasCustom = customWallpapers.some((item) => item.id === selectedId);

  return {
    selectedId: selectedId === "off" || selectedId === "auto" || hasBuiltIn || hasCustom ? selectedId : "auto",
    opacity: Math.min(48, Math.max(8, Number(source.opacity) || DEFAULT_WALLPAPER.opacity)),
    customWallpapers
  };
}

function wallpaperCatalog() {
  return [...BUILTIN_WALLPAPERS, ...(state.wallpaper?.customWallpapers || [])];
}

function resolvedWallpaper() {
  const settings = state.wallpaper || DEFAULT_WALLPAPER;
  if (settings.selectedId === "off") {
    return null;
  }
  const selectedId = settings.selectedId === "auto"
    ? (document.body.dataset.theme || "light") === "light" ? "dawn-desk"
      : (document.body.dataset.theme || "light") === "dark" ? "ink-moon"
        : (document.body.dataset.theme || "light") === "midnight" ? "star-voyage" : "amber-study"
    : settings.selectedId;
  return wallpaperCatalog().find((item) => item.id === selectedId) || BUILTIN_WALLPAPERS[0];
}

function setWallpaperMenuOpen(isOpen) {
  const open = Boolean(isOpen);
  els.wallpaperMenu?.classList.toggle("open", open);
  els.wallpaperMenu?.setAttribute("aria-hidden", String(!open));
  els.wallpaperToggleButton?.setAttribute("aria-expanded", String(open));
}

function renderWallpaperChoices() {
  if (!els.wallpaperBuiltinChoices) {
    return;
  }
  const settings = state.wallpaper || DEFAULT_WALLPAPER;
  const autoActive = settings.selectedId === "auto";
  const offActive = settings.selectedId === "off";
  els.wallpaperBuiltinChoices.innerHTML = [
    `<button class="wallpaper-choice auto ${autoActive ? "active" : ""}" type="button" data-wallpaper-id="auto"><span class="wallpaper-thumb auto" aria-hidden="true"></span><span><strong>自动匹配</strong><small>随主题切换</small></span></button>`,
    ...BUILTIN_WALLPAPERS.map((item) => `<button class="wallpaper-choice ${settings.selectedId === item.id ? "active" : ""}" type="button" data-wallpaper-id="${item.id}"><span class="wallpaper-thumb" style="background-image:url('${item.image}')" aria-hidden="true"></span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description)}</small></span></button>`),
    `<button class="wallpaper-choice off ${offActive ? "active" : ""}" type="button" data-wallpaper-id="off"><span class="wallpaper-thumb off" aria-hidden="true">×</span><span><strong>关闭壁纸</strong><small>只保留主题色</small></span></button>`
  ].join("");

  if (els.wallpaperCustomChoices) {
    const custom = settings.customWallpapers || [];
    els.wallpaperCustomChoices.innerHTML = custom.length
      ? `<span class="wallpaper-custom-label">我的壁纸</span>${custom.map((item) => `<button class="wallpaper-choice custom ${settings.selectedId === item.id ? "active" : ""}" type="button" data-wallpaper-id="${item.id}"><span class="wallpaper-thumb" style="background-image:url('${item.image}')" aria-hidden="true"></span><span><strong>${escapeHtml(item.name)}</strong><small>${item.workId === state.currentWork?.id ? "当前作品生成" : item.theme ? `${escapeHtml(THEME_OPTIONS[item.theme].label)}主题` : "自定义图片"}</small></span></button>`).join("")}`
      : "";
  }
}

function applyWallpaper({ persist = true } = {}) {
  state.wallpaper = normalizeWallpaper(state.wallpaper);
  const settings = state.wallpaper;
  const wallpaper = resolvedWallpaper();
  const opacity = settings.opacity / 100;
  document.body.dataset.wallpaperActive = wallpaper ? "true" : "false";
  document.body.style.setProperty("--wallpaper-image", wallpaper ? `url("${wallpaper.image.replace(/"/g, "%22")}")` : "none");
  document.body.style.setProperty("--wallpaper-opacity", String(opacity));
  document.body.style.setProperty("--wallpaper-surface", wallpaper ? `color-mix(in srgb, var(--panel) ${(100 - settings.opacity * 0.42).toFixed(0)}%, transparent)` : "var(--panel)");
  try {
    localStorage.setItem("motai.wallpaper", JSON.stringify(settings));
  } catch {
    // The local service remains the primary persistent store.
  }
  if (els.wallpaperOpacityInput) {
    els.wallpaperOpacityInput.value = String(settings.opacity);
  }
  if (els.wallpaperOpacityValue) {
    els.wallpaperOpacityValue.textContent = `${settings.opacity}%`;
  }
  renderWallpaperChoices();
  if (persist) {
    scheduleUiPreferencesSave();
  }
}

function selectWallpaper(id) {
  state.wallpaper = normalizeWallpaper({ ...state.wallpaper, selectedId: id });
  applyWallpaper();
}

function addCustomWallpaper(wallpaper) {
  const next = normalizeWallpaper(state.wallpaper);
  next.customWallpapers = [wallpaper, ...next.customWallpapers.filter((item) => item.id !== wallpaper.id)].slice(0, 12);
  next.selectedId = wallpaper.id;
  state.wallpaper = next;
  applyWallpaper();
}

function setThemeMenuOpen(isOpen) {
  const open = Boolean(isOpen);
  els.themeMenu?.classList.toggle("open", open);
  els.themeToggleButton?.setAttribute("aria-expanded", String(open));
}

function applyTheme(theme, { persist = true } = {}) {
  const nextTheme = THEME_OPTIONS[theme] ? theme : "light";
  document.body.dataset.theme = nextTheme;
  localStorage.setItem("motai.theme", nextTheme);
  if (els.themeToggleButton) {
    const option = THEME_OPTIONS[nextTheme];
    els.themeButtonIcon.textContent = option.icon;
    els.themeButtonLabel.textContent = option.label;
    els.themeToggleButton.title = `选择主题，当前：${option.label}`;
    els.themeToggleButton.setAttribute("aria-label", els.themeToggleButton.title);
  }
  els.themeOptionButtons.forEach((button) => {
    const active = button.dataset.themeOption === nextTheme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  applyWallpaper({ persist: false });
  applyHomeArt();
  if (persist) {
    scheduleUiPreferencesSave();
  }
}

function toggleThemeMenu() {
  setThemeMenuOpen(!els.themeMenu?.classList.contains("open"));
}

function setExportMenuOpen(isOpen) {
  const open = Boolean(isOpen);
  els.exportMenu?.classList.toggle("open", open);
  els.exportToggleButton?.setAttribute("aria-expanded", String(open));
}

function applyExportFormat(format, { persist = true } = {}) {
  const nextFormat = EXPORT_FORMAT_OPTIONS[format] ? format : "markdown";
  localStorage.setItem("motai.exportFormat", nextFormat);
  if (els.exportFormatSelect) {
    els.exportFormatSelect.value = nextFormat;
  }
  if (els.exportButtonLabel) {
    els.exportButtonLabel.textContent = EXPORT_FORMAT_OPTIONS[nextFormat];
  }
  if (els.exportToggleButton) {
    const label = EXPORT_FORMAT_OPTIONS[nextFormat];
    els.exportToggleButton.title = `选择导出格式，当前：${label}`;
    els.exportToggleButton.setAttribute("aria-label", els.exportToggleButton.title);
  }
  els.exportOptionButtons.forEach((button) => {
    const active = button.dataset.exportFormat === nextFormat;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  if (persist) {
    scheduleUiPreferencesSave();
  }
}

function rememberWorkspace(patch = {}) {
  state.restoredWorkspace = {
    ...state.restoredWorkspace,
    ...patch
  };

  try {
    localStorage.setItem(WORKSPACE_STATE_KEY, JSON.stringify({
      workId: state.currentWork?.id || state.restoredWorkspace.workId || "",
      chapterId: state.currentChapterId || state.restoredWorkspace.chapterId || "",
      mainView: state.mainView,
      previewMode: state.previewMode
    }));
  } catch {
    // The application remains usable when a browser blocks local storage.
  }
  scheduleUiPreferencesSave();
}

function toggleExportMenu() {
  setExportMenuOpen(!els.exportMenu?.classList.contains("open"));
}

function loadToolbarPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem("motai.toolbarPrefs") || "{}");
    state.toolbarPrefs = { ...DEFAULT_TOOLBAR_PREFS, ...parsed };
  } catch {
    state.toolbarPrefs = { ...DEFAULT_TOOLBAR_PREFS };
  }
}

function saveToolbarPrefs({ persist = true } = {}) {
  localStorage.setItem("motai.toolbarPrefs", JSON.stringify(state.toolbarPrefs || DEFAULT_TOOLBAR_PREFS));
  if (persist) {
    scheduleUiPreferencesSave();
  }
}

function applyToolbarPrefs() {
  if (!state.toolbarPrefs) {
    loadToolbarPrefs();
  }

  els.toolbarCards.forEach((card) => {
    const key = card.dataset.toolbarCard;
    card.classList.toggle("hidden", state.toolbarPrefs[key] === false);
  });

  els.toolbarToggles.forEach((input) => {
    input.checked = state.toolbarPrefs[input.dataset.toolbarToggle] !== false;
  });
}

function setInspectorTab(tab) {
  const allowed = new Set(["write", "bible", "characters", "world", "timeline", "cover", "work", "settings"]);
  const nextTab = allowed.has(tab) ? tab : "write";
  state.inspectorTab = nextTab;
  localStorage.setItem("motai.inspectorTab", nextTab);
  if (els.mainPanelTitle) {
    els.mainPanelTitle.textContent = MAIN_PANEL_TITLES[nextTab] || "工具工作台";
  }
  els.inspectorPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.inspectorPanel === nextTab);
  });
  scheduleUiPreferencesSave();
}

function currentUiPreferences() {
  return {
    theme: document.body.dataset.theme || "light",
    exportFormat: els.exportFormatSelect?.value || "markdown",
    inspectorTab: state.inspectorTab,
    toolbarPrefs: state.toolbarPrefs || DEFAULT_TOOLBAR_PREFS,
    wallpaper: state.wallpaper || DEFAULT_WALLPAPER,
    workspace: {
      workId: state.currentWork?.id || state.restoredWorkspace.workId || "",
      chapterId: state.currentChapterId || state.restoredWorkspace.chapterId || "",
      mainView: state.mainView,
      previewMode: state.previewMode
    }
  };
}

function scheduleUiPreferencesSave() {
  if (!state.uiPreferencesReady) {
    return;
  }

  window.clearTimeout(state.uiPreferencesTimer);
  state.uiPreferencesTimer = window.setTimeout(async () => {
    try {
      await request("/api/ui-preferences", {
        method: "PATCH",
        body: JSON.stringify(currentUiPreferences())
      });
    } catch {
      // Browser storage remains a safe fallback when the local service is unavailable.
    }
  }, 180);
}

function applyUiPreferences(preferences) {
  const saved = preferences && typeof preferences === "object" ? preferences : {};
  const workspace = saved.workspace && typeof saved.workspace === "object" ? saved.workspace : {};
  const nextMainView = MAIN_VIEWS.has(workspace.mainView) ? workspace.mainView : state.mainView;
  const allowedTabs = new Set(["write", "bible", "characters", "world", "timeline", "cover", "work", "settings"]);

  state.restoredWorkspace = {
    workId: typeof workspace.workId === "string" ? workspace.workId : state.restoredWorkspace.workId,
    chapterId: typeof workspace.chapterId === "string" ? workspace.chapterId : state.restoredWorkspace.chapterId,
    mainView: nextMainView,
    previewMode: Boolean(workspace.previewMode)
  };
  state.mainView = nextMainView;
  state.previewMode = Boolean(workspace.previewMode);
  state.inspectorTab = allowedTabs.has(saved.inspectorTab) ? saved.inspectorTab : state.inspectorTab;
  state.toolbarPrefs = { ...DEFAULT_TOOLBAR_PREFS, ...(saved.toolbarPrefs || {}) };
  state.wallpaper = normalizeWallpaper(saved.wallpaper);

  applyTheme(saved.theme, { persist: false });
  applyExportFormat(saved.exportFormat, { persist: false });
  localStorage.setItem("motai.inspectorTab", state.inspectorTab);
  saveToolbarPrefs({ persist: false });
  applyToolbarPrefs();
}

async function loadUiPreferences() {
  const { exists, preferences } = await request("/api/ui-preferences");
  if (exists) {
    applyUiPreferences(preferences);
  }
  state.uiPreferencesReady = true;
  if (!exists) {
    scheduleUiPreferencesSave();
  }
}

function setMainView(view) {
  const nextView = MAIN_VIEWS.has(view) ? view : "home";
  state.mainView = nextView;
  rememberWorkspace({ mainView: nextView });
  document.body.classList.toggle("home-active", nextView === "home");

  els.mainViewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mainView === nextView);
  });

  if (nextView === "home") {
    els.homeScreen?.classList.remove("hidden");
    els.studio?.classList.add("hidden");
    return;
  }

  els.homeScreen?.classList.add("hidden");
  els.studio?.classList.remove("hidden");

  if (nextView === "create") {
    closeMainPanel(false);
    return;
  }

  openMainPanel(nextView, false);
}

function mountMainPanels() {
  if (!els.mainWorkspace) {
    return;
  }

  const parts = [
    document.querySelector(".main-panel-head"),
    ...els.inspectorPanels
  ].filter(Boolean);

  parts.forEach((part) => {
    if (part.parentElement !== els.mainWorkspace) {
      els.mainWorkspace.appendChild(part);
    }
  });
}

function openMainPanel(tab = state.inspectorTab || "write", syncMainView = true) {
  els.studio?.classList.add("main-panel-open");
  els.mainWorkspace?.classList.remove("hidden");
  setInspectorTab(tab);
  if (syncMainView) {
    setMainView(tab);
  }
}

function closeMainPanel(syncMainView = true) {
  els.studio?.classList.remove("main-panel-open");
  els.mainWorkspace?.classList.add("hidden");
  if (syncMainView) {
    setMainView("create");
  }
}

function parseTags(value) {
  return String(value || "")
    .split(/[，,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }

  return payload;
}

async function loadWorks(preferredWorkId = "") {
  const { works } = await request("/api/works");
  state.works = works;
  renderWorks();

  if (works.length) {
    const selectedId = works.some((work) => work.id === preferredWorkId)
      ? preferredWorkId
      : works.some((work) => work.id === state.currentWork?.id)
      ? state.currentWork.id
      : works[0].id;
    await loadWork(selectedId);
    return;
  }

  state.currentWork = null;
  state.currentChapterId = null;
  renderEmptyWorkspace();
}

async function loadWork(workId) {
  const loadVersion = ++state.workLoadVersion;
  const { work } = await request(`/api/works/${workId}`);
  if (loadVersion !== state.workLoadVersion) {
    return;
  }
  state.currentWork = work;
  state.storyBibleQuality = null;
  const restoredChapterId = state.restoredWorkspace.workId === work.id
    ? state.restoredWorkspace.chapterId
    : "";
  const requestedChapterId = state.currentChapterId || restoredChapterId;
  state.currentChapterId = requestedChapterId && work.chapters.some((chapter) => chapter.id === requestedChapterId)
    ? requestedChapterId
    : work.chapters[0]?.id;
  rememberWorkspace({ workId: work.id, chapterId: state.currentChapterId || "" });
  renderAll();
}

async function loadAiStatus() {
  try {
    const { config } = await request("/api/ai/config");
    applyAiConfig(config);
  } catch (error) {
    state.aiConfigured = false;
    els.aiStatus.textContent = "AI 不可用";
  }
}

function applyAiConfig(config) {
  state.aiConfig = config;
  state.aiConfigured = Boolean(config.configured);
  renderAiConfigForm(config);

  const fallbackLabel = config.localFallback ? " · 备用开启" : "";
  const endpointLabel = config.endpoint === "responses" ? "Responses" : config.endpoint === "chat" ? "Chat" : "本地";
  const imageLabel = config.image?.configured
    ? " · 封面已配置"
    : " · 封面未配置";
  if (config.statusProvider === "local" || config.provider === "local") {
    els.aiStatus.textContent = `本地备用模式${imageLabel}`;
    return;
  }

  els.aiStatus.textContent = state.aiConfigured
    ? `已配置 ${config.providerLabel || config.provider} · ${endpointLabel}${fallbackLabel}${imageLabel}`
    : "未配置 API Key";
}

function renderAiConfigForm(config) {
  if (!config) {
    return;
  }

  if (!els.aiProviderSelect.options.length) {
    els.aiProviderSelect.innerHTML = (config.providers || []).map((provider) => `
      <option value="${escapeHtml(provider.value)}">${escapeHtml(provider.label)}</option>
    `).join("");
  }

  els.aiProviderSelect.value = config.provider || "openai";
  els.aiKeyInput.value = "";
  els.aiKeyInput.placeholder = config.hasApiKey ? "已保存，留空不修改" : "请输入 API Key";
  els.aiBaseUrlInput.value = config.baseUrl || "";
  els.aiModelInput.value = config.model || "";
  els.aiEndpointSelect.value = config.endpoint || "responses";
  els.aiMaxTokensInput.value = config.maxOutputTokens || 3200;
  els.aiTimeoutInput.value = config.timeoutMs || 30000;
  const image = config.image || {};
  els.imageKeyInput.value = "";
  els.imageKeyInput.placeholder = image.hasApiKey ? "已保存，留空不修改" : "填写图片 API Key";
  els.imageBaseUrlInput.value = image.baseUrl || "https://api.openai.com/v1";
  els.imageModelInput.value = image.model || "gpt-image-1";
  els.imageTimeoutInput.value = image.timeoutMs || 60000;
  els.aiProxyInput.value = config.proxy || "";
  els.aiFallbackInput.checked = Boolean(config.localFallback);
  const imageHint = image.configured
    ? `图片接口：${image.reusesTextApi ? "复用文本接口" : "单独配置"} · ${image.model || ""}`
    : "图片接口未配置：封面生成需要填写图片 API Key。";
  els.aiConfigNote.textContent = `${AI_PROVIDER_HINTS[config.provider] || ""} ${imageHint}`.trim();
}

function renderAll() {
  renderWorks();
  renderWorkDetails();
  renderChapters();
  renderEditor();
  renderStats();
}

function renderEmptyWorkspace() {
  els.workTitleInput.value = "";
  els.workGenreLabel.textContent = "";
  els.chapterList.innerHTML = `<div class="empty-state">暂无章节</div>`;
  els.chapterTitleInput.value = "";
  els.chapterStatusSelect.value = "draft";
  els.chapterContentInput.value = "";
  els.chapterPreview.textContent = "";
  resetEditorHistory("");
  els.totalCharacters.textContent = "0";
  els.chapterCharacters.textContent = "0";
  els.readingTime.textContent = "0";
  els.progressLabel.textContent = "0%";
  els.progressFill.style.width = "0%";
  els.genreInput.value = "";
  els.workStatusSelect.value = "draft";
  els.targetInput.value = "";
  els.boldnessInput.value = "50";
  els.boldnessValue.textContent = "50 · 平衡";
  els.tagsInput.value = "";
  els.premiseInput.value = "";
  if (els.coverImage) {
    els.coverImage.src = "/assets/writing-workspace.png";
  }
  if (els.coverPromptInput) {
    els.coverPromptInput.value = "";
  }
  if (els.coverLoglineInput) els.coverLoglineInput.value = "";
  if (els.coverPaletteSelect) els.coverPaletteSelect.value = "gold";
  if (els.coverTitleAlignSelect) els.coverTitleAlignSelect.value = "left";
  if (els.coverShowTitleInput) els.coverShowTitleInput.checked = true;
  if (els.coverShowMetadataInput) els.coverShowMetadataInput.checked = true;
  if (els.coverShowLoglineInput) els.coverShowLoglineInput.checked = true;
  if (els.coverShowAuthorInput) els.coverShowAuthorInput.checked = true;
  if (els.coverStatus) {
    els.coverStatus.textContent = "暂无作品";
  }
  renderCoverHistory();
  renderStoryBible(emptyStoryBible());
  renderStoryBibleQuality(null);
  renderChapterBoard();
  renderChapterPlanning();
}

function renderWorks() {
  const keyword = state.search.trim().toLowerCase();
  const filtered = state.works.filter((work) => {
    const bag = `${work.title} ${work.genre} ${(work.tags || []).join(" ")} ${work.premise}`.toLowerCase();
    return !keyword || bag.includes(keyword);
  });

  if (!filtered.length) {
    els.workList.innerHTML = `<div class="empty-state">没有匹配作品</div>`;
    return;
  }

  els.workList.innerHTML = filtered.map((work) => {
    const active = state.currentWork?.id === work.id ? " active" : "";
    const status = STATUS_LABELS[work.status] || "草稿";
    const count = formatNumber(work.stats?.totalCharacters || 0);
    const cover = escapeHtml(work.cover || "/assets/writing-workspace.png");

    return `
      <article class="work-card${active}" data-work-id="${work.id}" tabindex="0" role="button" aria-label="打开作品：${escapeHtml(work.title)}">
        <button class="work-card-delete" type="button" data-delete-work-id="${work.id}" aria-label="删除作品：${escapeHtml(work.title)}" title="删除作品">
          <span aria-hidden="true">×</span>
        </button>
        <img class="work-card-cover" src="${cover}" alt="" loading="lazy">
        <span class="work-card-title">${escapeHtml(work.title)}</span>
        <span class="work-card-meta">
          <span>${escapeHtml(work.genre || "原创")}</span>
          <span>${status}</span>
          <span>${count} 字</span>
        </span>
      </article>
    `;
  }).join("");
}

function renderWorkDetails() {
  const work = state.currentWork;

  if (!work) {
    return;
  }

  els.workTitleInput.value = work.title || "";
  els.workGenreLabel.textContent = `${work.genre || "原创"} · ${STATUS_LABELS[work.status] || "草稿"}`;
  els.authorInput.value = work.author || "未署名";
  els.genreInput.value = work.genre || "";
  els.workStatusSelect.value = work.status || "draft";
  els.targetInput.value = work.targetCharacters || 0;
  els.boldnessInput.value = work.boldness ?? 50;
  els.boldnessValue.textContent = `${els.boldnessInput.value} · ${getBoldnessLabel(els.boldnessInput.value)}`;
  els.tagsInput.value = (work.tags || []).join("，");
  els.premiseInput.value = work.premise || "";
  if (els.coverImage) {
    els.coverImage.src = work.cover || "/assets/writing-workspace.png";
  }
  if (els.coverStatus) {
    els.coverStatus.textContent = work.cover ? "已设置封面" : "可生成或添加封面";
  }
  const coverStyle = work.coverStyle && typeof work.coverStyle === "object" ? work.coverStyle : {};
  if (els.coverLoglineInput) els.coverLoglineInput.value = work.coverLogline || "";
  if (els.coverPaletteSelect) els.coverPaletteSelect.value = coverStyle.palette || "gold";
  if (els.coverTitleAlignSelect) els.coverTitleAlignSelect.value = coverStyle.titleAlign || "left";
  if (els.coverShowTitleInput) els.coverShowTitleInput.checked = coverStyle.showTitle !== false;
  if (els.coverShowMetadataInput) els.coverShowMetadataInput.checked = coverStyle.showMetadata !== false;
  if (els.coverShowLoglineInput) els.coverShowLoglineInput.checked = coverStyle.showLogline !== false;
  if (els.coverShowAuthorInput) els.coverShowAuthorInput.checked = coverStyle.showAuthor !== false;
  renderCoverHistory();
  renderStoryBible(work.storyBible);
  renderStoryBibleQuality(state.storyBibleQuality);
}

function coverHistoryItems(work = state.currentWork) {
  if (!Array.isArray(work?.coverHistory)) {
    return [];
  }
  return work.coverHistory.filter((item) => item && item.id && item.cover);
}

function coverHistoryLabel(item) {
  if (item.source === "upload") {
    return "本地添加";
  }
  if (item.source === "legacy") {
    return "已有封面";
  }
  if (item.source === "layout") {
    return "信息排版";
  }
  return "AI 生成";
}

function renderStoryBibleQuality(quality) {
  if (!els.storyQualitySummary || !els.storyQualityChecks || !els.storyQualityIssues) return;
  if (!quality) {
    els.storyQualitySummary.textContent = "生成后可检查完整度、题材一致性与章节可执行性。";
    els.storyQualityChecks.innerHTML = "";
    els.storyQualityIssues.innerHTML = "";
    renderStoryRoadmap(null);
    return;
  }
  els.storyQualitySummary.textContent = `${quality.level || "已检查"} · ${Number(quality.score || 0)} 分 · ${quality.ok ? "设定可以进入写作" : "建议先补足以下问题"}`;
  els.storyQualityChecks.innerHTML = (quality.checks || []).map((check) => `<span class="quality-chip ${check.passed ? "passed" : "failed"}" title="${escapeHtml(check.detail || "")}">${check.passed ? "✓" : "!"} ${escapeHtml(check.label)}</span>`).join("");
  els.storyQualityIssues.innerHTML = (quality.issues || []).map((issue) => {
    const action = getStoryQualityAction(issue);
    return `<li><span>${escapeHtml(issue)}</span>${action ? `<button class="story-quality-fix" type="button" data-story-guide-action="${action.id}">${escapeHtml(action.label)}</button>` : ""}</li>`;
  }).join("");
  renderStoryRoadmap(quality);
}

function getStoryQualityAction(issue) {
  const text = String(issue || "");
  if (/章节规划|剧情目标|成长点|爽点|结尾钩子/.test(text)) {
    return { id: "timeline", label: "补章节规划" };
  }
  if (/人物|关系网|关系图|占位名/.test(text)) {
    return { id: "characters", label: "补人物关系" };
  }
  if (/题材|原作世界|混入/.test(text)) {
    return { id: "work", label: "检查梗概" };
  }
  if (/复读|内容太短|缺少/.test(text)) {
    return { id: "bible", label: "补核心设定" };
  }
  return null;
}

function focusStoryGuideTarget(selector) {
  window.requestAnimationFrame(() => {
    const target = document.querySelector(selector);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.focus({ preventScroll: true });
  });
}

function renderStoryRoadmap(quality) {
  if (!els.storyRoadmapSteps || !els.storyRoadmapSummary) return;
  const work = state.currentWork;
  if (!work) {
    els.storyRoadmapSteps.innerHTML = "";
    return;
  }
  const bible = normalizeStoryBible(work.storyBible);
  const hasPremise = Boolean(String(work.premise || "").trim());
  const hasBible = Boolean(bible.worldview && bible.characters && bible.outline && bible.chapterPlan);
  const hasCharacters = parseCharacterCards(bible.characters).length >= 4 && parseRelationshipCards(bible.relationships).length >= 3;
  const hasPlan = String(bible.chapterPlan || "").split(/\r?\n+/).filter((line) => line.trim()).length >= 8;
  const hasWrittenContent = (work.chapters || []).some((chapter) => String(chapter.content || "").trim().length > 0);
  const steps = [
    { id: "work", title: "写清一句话梗概", detail: "交代主角、处境、目标和阻力。", done: hasPremise, label: "编辑梗概" },
    { id: "generate", title: "按梗概生成设定", detail: "生成世界观、人物、主线和第一卷章纲。", done: hasBible, label: "生成设定" },
    { id: "characters", title: "确认人物关系", detail: "至少 4 个有姓名的人物，至少 3 条带箭头的关系。", done: hasCharacters, label: "编辑人物" },
    { id: "timeline", title: "检查章节推进", detail: "先保证 8 章以上；每章要有目标、冲突和结尾钩子。", done: hasPlan, label: "编辑章纲" },
    { id: "write", title: "按章开始写作", detail: "选择当前章节，在写作页直接输入，或用 AI 助手续写。", done: hasWrittenContent, label: "开始写作" }
  ];
  const completeCount = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done);
  els.storyRoadmapSummary.textContent = nextStep
    ? `已完成 ${completeCount}/5 · 下一步：${nextStep.title}`
    : quality?.ok ? "已完成 5/5 · 设定可作为 AI 写作上下文。" : "已完成基础资料 · 点击“检查下一步”确认质量。";
  els.storyRoadmapSteps.innerHTML = steps.map((step, index) => `
    <li class="story-roadmap-step ${step.done ? "done" : ""} ${!step.done && step === nextStep ? "next" : ""}">
      <span class="story-roadmap-number">${step.done ? "✓" : index + 1}</span>
      <div><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.detail)}</small></div>
      <button class="button ghost compact" type="button" data-story-guide-action="${step.id}">${escapeHtml(step.done ? "查看" : step.label)}</button>
    </li>`).join("");
}

async function handleStoryGuideAction(action) {
  if (!state.currentWork) return;
  if (action === "generate") {
    await generateStoryBible();
    return;
  }
  if (action === "quality") {
    await checkStoryBibleQuality();
    return;
  }
  if (action === "work") {
    openMainPanel("work");
    focusStoryGuideTarget("#premiseInput");
    return;
  }
  if (action === "characters") {
    openMainPanel("characters");
    focusStoryGuideTarget("#addCharacterCardButton");
    return;
  }
  if (action === "timeline") {
    openMainPanel("timeline");
    focusStoryGuideTarget('[data-inspector-panel="timeline"] [data-story-field="chapterPlan"]');
    return;
  }
  if (action === "bible") {
    openMainPanel("bible");
    focusStoryGuideTarget('[data-inspector-panel="bible"] [data-story-field="worldview"]');
    return;
  }
  if (action === "write") {
    setMainView("create");
    focusStoryGuideTarget("#chapterContentInput");
  }
}

async function checkStoryBibleQuality() {
  if (!state.currentWork) return;
  const button = els.storyQualityCheckButton;
  if (button) button.disabled = true;
  try {
    await saveWork({ storyBible: collectStoryBible(), boldness: Number(els.boldnessInput.value) || 50 });
    const payload = await request(`/api/works/${state.currentWork.id}/story-bible/check`, { method: "POST", body: "{}" });
    state.storyBibleQuality = payload.quality;
    renderStoryBibleQuality(payload.quality);
    toast(payload.quality.ok ? `设定检查通过：${payload.quality.score} 分` : `设定检查：${payload.quality.score} 分，请补足提示项`);
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderCoverHistory() {
  const history = coverHistoryItems();
  if (els.coverHistoryCount) {
    els.coverHistoryCount.textContent = `${history.length} 个版本`;
  }
  if (els.coverHistoryList) {
    els.coverHistoryList.innerHTML = history.length
      ? history.map((item) => {
        const active = item.cover === state.currentWork?.cover;
        const timestamp = item.createdAt ? new Date(item.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
        return `<button class="cover-history-item ${active ? "active" : ""}" type="button" data-cover-history-id="${escapeHtml(item.id)}" aria-label="${active ? "当前封面" : "设为当前封面"}：${escapeHtml(coverHistoryLabel(item))}"><img src="${escapeHtml(item.cover)}" alt="${escapeHtml(coverHistoryLabel(item))}封面"><span><strong>${active ? "当前封面" : coverHistoryLabel(item)}</strong><small>${escapeHtml(timestamp)}</small></span></button>`;
      }).join("")
      : `<p class="cover-history-empty">生成或添加封面后，版本会出现在这里。</p>`;
  }
  if (els.quickCoverHistory) {
    els.quickCoverHistory.innerHTML = history.length
      ? history.slice(0, 3).map((item) => `<button class="mini-cover ${item.cover === state.currentWork?.cover ? "active" : ""}" type="button" data-cover-history-id="${escapeHtml(item.id)}" title="${escapeHtml(item.cover === state.currentWork?.cover ? "当前封面" : "设为当前封面")}"><img src="${escapeHtml(item.cover)}" alt=""></button>`).join("")
      : `<span class="mini-cover-empty">封面</span>`;
  }
  if (els.quickCoverNote) {
    els.quickCoverNote.textContent = history.length ? `已保存 ${history.length} 个封面版本` : "生成或添加的封面会保存在这里。";
  }
}

async function selectCoverHistory(historyId) {
  const work = state.currentWork;
  if (!work || !historyId) {
    return;
  }
  const selected = coverHistoryItems(work).find((item) => item.id === historyId);
  if (!selected || selected.cover === work.cover) {
    return;
  }
  try {
    const payload = await request(`/api/works/${work.id}/cover/select`, {
      method: "POST",
      body: JSON.stringify({ historyId })
    });
    state.currentWork = payload.work;
    updateSummaryFromCurrentWork();
    renderWorkDetails();
    renderWorks();
    setSaveState(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    toast("已切换当前封面");
  } catch (error) {
    toast(error.message);
  }
}

function safeChapterImagePath(value) {
  const match = String(value || "").trim().match(/^\/data\/covers\/(illustration-[a-z0-9_-]+\.(?:png|jpe?g|webp))$/i);
  return match ? `/data/covers/${match[1]}` : "";
}

function renderChapterPreview(content) {
  return String(content || "")
    .split(/\n{2,}|\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const match = block.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/u);
      const imagePath = match ? safeChapterImagePath(match[2]) : "";
      if (imagePath) {
        return `<figure class="chapter-illustration"><img src="${imagePath}" alt="${escapeHtml(match[1] || "章节插图")}" loading="lazy"><figcaption>${escapeHtml(match[1] || "章节插图")}</figcaption></figure>`;
      }
      return `<p>${escapeHtml(block).replace(/\r?\n/g, "<br>")}</p>`;
    })
    .join("");
}

function renderStoryBible(storyBible) {
  const data = normalizeStoryBible(storyBible);
  els.storyBibleInputs.forEach((input) => {
    input.value = data[input.dataset.storyField] || "";
  });
  renderCharacterMap(data);
  renderStructuredCharacters(data);
}

function collectStoryBible() {
  const data = emptyStoryBible();
  els.storyBibleInputs.forEach((input) => {
    data[input.dataset.storyField] = input.value;
  });
  return data;
}

function normalizeCharacterCard(card = {}) {
  return {
    name: String(card.name || "").trim().slice(0, 24),
    identity: String(card.identity || "").trim().slice(0, 140),
    goal: String(card.goal || "").trim().slice(0, 180),
    secret: String(card.secret || "").trim().slice(0, 180),
    arc: String(card.arc || "").trim().slice(0, 180)
  };
}

function parseCharacterCards(text) {
  return splitStructuredLines(text).map((line) => {
    const match = line.match(/^\s*(?:[-*•·、0-9.]+\s*)?([^：:]{2,24})[：:]\s*(.*)$/u);
    if (!match) {
      return null;
    }
    const name = normalizeCharacterCandidate(match[1]);
    if (!isLikelyCharacterName(name)) {
      return null;
    }
    const segments = match[2].split(/[｜|]/u).map((item) => item.trim()).filter(Boolean);
    const card = { name, identity: "", goal: "", secret: "", arc: "" };
    segments.forEach((segment) => {
      if (/^目标[：:]/u.test(segment)) card.goal = segment.replace(/^目标[：:]\s*/u, "");
      else if (/^(秘密|弱点)[：:]/u.test(segment)) card.secret = segment.replace(/^(秘密|弱点)[：:]\s*/u, "");
      else if (/^(成长弧|成长)[：:]/u.test(segment)) card.arc = segment.replace(/^(成长弧|成长)[：:]\s*/u, "");
      else card.identity = card.identity ? `${card.identity}；${segment}` : segment;
    });
    return normalizeCharacterCard(card);
  }).filter(Boolean);
}

function characterCardsToText(cards) {
  return cards.map((source) => {
    const card = normalizeCharacterCard(source);
    if (!card.name) return "";
    return [
      `${card.name}：${card.identity || "待补充身份与立场"}`,
      card.goal && `目标：${card.goal}`,
      card.secret && `秘密：${card.secret}`,
      card.arc && `成长弧：${card.arc}`
    ].filter(Boolean).join("｜");
  }).filter(Boolean).join("\n");
}

function normalizeRelationshipCard(card = {}) {
  return {
    from: String(card.from || "").trim().slice(0, 24),
    to: String(card.to || "").trim().slice(0, 24),
    type: String(card.type || "关联").trim().slice(0, 32),
    status: String(card.status || "").trim().slice(0, 120),
    conflict: String(card.conflict || "").trim().slice(0, 160)
  };
}

function parseRelationshipCards(text) {
  return splitStructuredLines(text).map((line) => {
    const match = line.match(/^\s*([^\-→：:]{2,24})\s*(?:->|→)\s*([^：:]{2,24})[：:]\s*(.*)$/u);
    if (!match) return null;
    const segments = match[3].split(/[｜|]/u).map((item) => item.trim()).filter(Boolean);
    const card = { from: normalizeCharacterCandidate(match[1]), to: normalizeCharacterCandidate(match[2]), type: segments.shift() || "关联", status: "", conflict: "" };
    segments.forEach((segment) => {
      if (/^状态[：:]/u.test(segment)) card.status = segment.replace(/^状态[：:]\s*/u, "");
      else if (/^(矛盾|冲突)[：:]/u.test(segment)) card.conflict = segment.replace(/^(矛盾|冲突)[：:]\s*/u, "");
      else card.status = card.status ? `${card.status}；${segment}` : segment;
    });
    return card.from && card.to ? normalizeRelationshipCard(card) : null;
  }).filter(Boolean);
}

function relationshipCardsToText(cards) {
  return cards.map((source) => {
    const card = normalizeRelationshipCard(source);
    if (!card.from || !card.to) return "";
    return [`${card.from} -> ${card.to}：${card.type || "关联"}`, card.status && `状态：${card.status}`, card.conflict && `矛盾：${card.conflict}`].filter(Boolean).join("｜");
  }).filter(Boolean).join("\n");
}

function renderStructuredCharacters(storyBible) {
  if (!els.characterCardList || !els.relationshipCardList) return;
  const characters = parseCharacterCards(storyBible.characters);
  const relationships = parseRelationshipCards(storyBible.relationships);
  els.characterCardList.innerHTML = characters.length ? characters.map((card, index) => `
    <article class="structured-card" data-character-card-index="${index}">
      <div class="structured-card-title"><strong>人物 ${index + 1}</strong><button class="icon-button" type="button" data-remove-character-card="${index}" aria-label="删除人物">×</button></div>
      <label><span>姓名</span><input data-character-card-field="name" value="${escapeHtml(card.name)}"></label>
      <label><span>身份/立场</span><input data-character-card-field="identity" value="${escapeHtml(card.identity)}"></label>
      <label><span>目标</span><input data-character-card-field="goal" value="${escapeHtml(card.goal)}"></label>
      <label><span>秘密/弱点</span><input data-character-card-field="secret" value="${escapeHtml(card.secret)}"></label>
      <label><span>成长弧</span><input data-character-card-field="arc" value="${escapeHtml(card.arc)}"></label>
    </article>`).join("") : `<p class="structured-empty">还没有可解析的人物。点击“添加人物”，或在高级文本中使用“姓名：身份｜目标：…”格式。</p>`;
  els.relationshipCardList.innerHTML = relationships.length ? relationships.map((card, index) => `
    <article class="structured-card relationship" data-relationship-card-index="${index}">
      <div class="structured-card-title"><strong>关系 ${index + 1}</strong><button class="icon-button" type="button" data-remove-relationship-card="${index}" aria-label="删除关系">×</button></div>
      <label><span>人物 A</span><input data-relationship-card-field="from" value="${escapeHtml(card.from)}"></label>
      <label><span>人物 B</span><input data-relationship-card-field="to" value="${escapeHtml(card.to)}"></label>
      <label><span>关系类型</span><input data-relationship-card-field="type" value="${escapeHtml(card.type)}"></label>
      <label><span>当前状态</span><input data-relationship-card-field="status" value="${escapeHtml(card.status)}"></label>
      <label><span>主要矛盾</span><input data-relationship-card-field="conflict" value="${escapeHtml(card.conflict)}"></label>
    </article>`).join("") : `<p class="structured-empty">还没有可解析的关系。使用“甲 -> 乙：关系类型｜状态：…｜矛盾：…”格式即可生成箭头。</p>`;
}

function persistStructuredStoryBible(storyBible) {
  const workId = state.currentWork?.id;
  if (!workId) return;
  state.currentWork.storyBible = storyBible;
  els.storyBibleInputs.forEach((input) => {
    input.value = storyBible[input.dataset.storyField] || "";
  });
  renderCharacterMap(storyBible);
  setSaveState("未保存");
  debouncedWorkSave({ storyBible, boldness: Number(els.boldnessInput.value) || 50 }, workId);
}

function runStructuredActionOnce(action) {
  if (state.structuredActionLocked) {
    return;
  }

  state.structuredActionLocked = true;
  try {
    action();
  } finally {
    window.setTimeout(() => {
      state.structuredActionLocked = false;
    }, 0);
  }
}

function updateStructuredCharacterCard(event) {
  const container = event.target.closest("[data-character-card-index]");
  if (!container || !event.target.dataset.characterCardField) return;
  const storyBible = collectStoryBible();
  const cards = parseCharacterCards(storyBible.characters);
  const index = Number(container.dataset.characterCardIndex);
  if (!cards[index]) return;
  cards[index][event.target.dataset.characterCardField] = event.target.value;
  storyBible.characters = characterCardsToText(cards);
  persistStructuredStoryBible(storyBible);
}

function updateStructuredRelationshipCard(event) {
  const container = event.target.closest("[data-relationship-card-index]");
  if (!container || !event.target.dataset.relationshipCardField) return;
  const storyBible = collectStoryBible();
  const cards = parseRelationshipCards(storyBible.relationships);
  const index = Number(container.dataset.relationshipCardIndex);
  if (!cards[index]) return;
  cards[index][event.target.dataset.relationshipCardField] = event.target.value;
  storyBible.relationships = relationshipCardsToText(cards);
  persistStructuredStoryBible(storyBible);
}

function renderChapters() {
  const chapters = state.currentWork?.chapters || [];

  if (!chapters.length) {
    els.chapterList.innerHTML = `<div class="empty-state">暂无章节</div>`;
    renderChapterBoard();
    return;
  }

  els.chapterList.innerHTML = chapters.map((chapter, index) => {
    const active = chapter.id === state.currentChapterId ? " active" : "";
    const characters = countCharacters(chapter.content);
    const status = STATUS_LABELS[chapter.status] || "草稿";

    return `
      <article class="chapter-row${active}">
        <button class="chapter-card${active}" type="button" data-chapter-id="${chapter.id}">
          <span class="chapter-card-title">${index + 1}. ${escapeHtml(chapter.title || "未命名章节")}</span>
          <span class="chapter-meta">
            <span>${status}</span>
            <span>${formatNumber(characters)} 字</span>
          </span>
        </button>
        <div class="chapter-card-actions" aria-label="章节操作">
          <button class="chapter-card-action" type="button" data-rename-chapter-id="${chapter.id}" title="重命名章节">改名</button>
          <button class="chapter-card-action danger" type="button" data-delete-chapter-id="${chapter.id}" title="删除章节">删除</button>
        </div>
      </article>
    `;
  }).join("");
  renderChapterBoard();
}

function normalizeChapterPlanning(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    goal: String(source.goal || ""),
    scene: String(source.scene || ""),
    characters: String(source.characters || ""),
    conflict: String(source.conflict || ""),
    hook: String(source.hook || "")
  };
}

function renderChapterBoard() {
  if (!els.chapterBoard) return;
  const chapters = state.currentWork?.chapters || [];
  const columns = [
    { status: "draft", label: "草稿" },
    { status: "editing", label: "写作中" },
    { status: "done", label: "已完成" }
  ];
  if (els.chapterBoardSummary) {
    els.chapterBoardSummary.textContent = `${chapters.length} 个章节 · ${chapters.filter((chapter) => chapter.status === "done").length} 已完成`;
  }
  els.chapterBoard.innerHTML = columns.map((column) => {
    const items = chapters.filter((chapter) => (chapter.status || "draft") === column.status);
    return `<section class="chapter-board-column status-${column.status}">
      <header><strong>${column.label}</strong><span>${items.length}</span></header>
      <div>${items.length ? items.map((chapter, index) => {
        const planning = normalizeChapterPlanning(chapter.planning);
        const active = chapter.id === state.currentChapterId ? " active" : "";
        return `<button class="chapter-board-card${active}" type="button" data-board-chapter-id="${escapeHtml(chapter.id)}">
          <small>第${chapters.indexOf(chapter) + 1}章 · ${formatNumber(countCharacters(chapter.content))} 字</small>
          <strong>${escapeHtml(chapter.title || "未命名章节")}</strong>
          <span>${escapeHtml(planning.goal || planning.scene || "未填写本章目标")}</span>
          ${planning.hook ? `<em>钩子：${escapeHtml(planning.hook)}</em>` : ""}
        </button>`;
      }).join("") : `<p class="chapter-board-empty">暂时没有章节</p>`}</div>
    </section>`;
  }).join("");
}

function renderChapterPlanning() {
  const chapter = currentChapter();
  const planning = normalizeChapterPlanning(chapter?.planning);
  const fields = [
    [els.chapterGoalInput, "goal"], [els.chapterSceneInput, "scene"], [els.chapterCharactersInput, "characters"],
    [els.chapterConflictInput, "conflict"], [els.chapterHookInput, "hook"]
  ];
  fields.forEach(([input, key]) => {
    if (!input) return;
    input.value = planning[key];
    input.disabled = !chapter;
  });
  if (els.chapterPlanningLabel) {
    els.chapterPlanningLabel.textContent = chapter ? `正在编辑：${chapter.title || "未命名章节"}` : "选择一个章节后填写本章的推进目标。";
  }
}

function renderEditor() {
  const chapter = currentChapter();

  if (!chapter) {
    els.chapterTitleInput.value = "";
    els.chapterContentInput.value = "";
    els.chapterPreview.innerHTML = "";
    resetEditorHistory("");
    renderChapterPlanning();
    return;
  }

  els.chapterTitleInput.value = chapter.title || "";
  els.chapterStatusSelect.value = chapter.status || "draft";
  els.chapterContentInput.value = chapter.content || "";
  els.chapterPreview.innerHTML = renderChapterPreview(chapter.content);
  resetEditorHistory(chapter.content || "");
  updateEditorMode();
  renderChapterPlanning();
}

function renderStats() {
  const work = state.currentWork;
  const chapter = currentChapter();
  const total = (work?.chapters || []).reduce((sum, item) => sum + countCharacters(item.content), 0);
  const chapterTotal = countCharacters(chapter?.content || "");
  const target = Number(work?.targetCharacters || 0);
  const progress = target ? Math.min(100, Math.round((total / target) * 100)) : 0;

  els.totalCharacters.textContent = formatNumber(total);
  els.chapterCharacters.textContent = formatNumber(chapterTotal);
  els.readingTime.textContent = formatNumber(Math.max(1, Math.ceil(chapterTotal / 500)));
  els.progressLabel.textContent = `${progress}%`;
  els.progressFill.style.width = `${progress}%`;
}

function updateEditorMode() {
  els.chapterContentInput.classList.toggle("hidden", state.previewMode);
  els.chapterPreview.classList.toggle("hidden", !state.previewMode);
  els.writeModeButton.classList.toggle("active", !state.previewMode);
  els.previewModeButton.classList.toggle("active", state.previewMode);
}

function resetEditorHistory(value = "") {
  state.editorUndoStack = [];
  state.editorRedoStack = [];
  state.lastEditorValue = value;
  state.lastHistoryAt = 0;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  if (els.undoButton) {
    els.undoButton.disabled = !state.editorUndoStack.length;
  }
  if (els.redoButton) {
    els.redoButton.disabled = !state.editorRedoStack.length;
  }
}

function pushEditorHistory(value) {
  if (state.editorUndoStack.at(-1) !== value) {
    state.editorUndoStack.push(value);
  }
  if (state.editorUndoStack.length > 80) {
    state.editorUndoStack.shift();
  }
  state.editorRedoStack = [];
  state.lastHistoryAt = Date.now();
  updateHistoryButtons();
}

function rememberEditorValue(nextValue) {
  if (state.suppressHistory) {
    state.lastEditorValue = nextValue;
    return;
  }

  if (nextValue === state.lastEditorValue) {
    return;
  }

  const now = Date.now();
  const isContinuousTyping = state.lastHistoryAt && now - state.lastHistoryAt < 650 && Math.abs(nextValue.length - state.lastEditorValue.length) <= 4;
  if (!isContinuousTyping) {
    pushEditorHistory(state.lastEditorValue);
  } else {
    state.editorRedoStack = [];
  }

  state.lastEditorValue = nextValue;
  updateHistoryButtons();
}

function applyEditorContent(value, options = {}) {
  const chapter = currentChapter();
  if (!chapter) {
    return;
  }

  const nextValue = String(value || "");
  if (options.trackHistory && els.chapterContentInput.value !== nextValue) {
    pushEditorHistory(els.chapterContentInput.value);
  }

  state.suppressHistory = true;
  els.chapterContentInput.value = nextValue;
  chapter.content = nextValue;
  els.chapterPreview.innerHTML = renderChapterPreview(nextValue);
  state.lastEditorValue = nextValue;
  state.suppressHistory = false;

  setSaveState("未保存");
  renderStats();
  renderChapters();
  debouncedChapterSave({ content: nextValue });
  updateHistoryButtons();
}

function popDifferent(stack, currentValue) {
  let value = stack.pop();
  while (value === currentValue && stack.length) {
    value = stack.pop();
  }
  return value;
}

function undoEditor() {
  const previous = popDifferent(state.editorUndoStack, els.chapterContentInput.value);
  if (previous === undefined) {
    return;
  }

  state.editorRedoStack.push(els.chapterContentInput.value);
  applyEditorContent(previous);
}

function redoEditor() {
  const next = popDifferent(state.editorRedoStack, els.chapterContentInput.value);
  if (next === undefined) {
    return;
  }

  state.editorUndoStack.push(els.chapterContentInput.value);
  applyEditorContent(next);
}

function normalizeParagraph(text) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([，。！？；：、])\s*/g, "$1")
    .replace(/\s*([,.!?;:])\s*/g, "$1 ")
    .trim();
}

function formatNovelText(text) {
  const paragraphs = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((item) => normalizeParagraph(item))
    .filter(Boolean);

  return paragraphs.map((paragraph) => {
    const clean = paragraph.replace(/^　+/, "");
    return clean.startsWith("“") || clean.startsWith("「") || clean.startsWith("『")
      ? `　　${clean}`
      : `　　${clean}`;
  }).join("\n\n");
}

function autoFormatChapter() {
  const source = els.chapterContentInput.value;
  const formatted = formatNovelText(source);

  if (!source.trim()) {
    toast("先写一点正文");
    return;
  }

  if (formatted === source) {
    toast("排版已经很整洁");
    return;
  }

  state.previewMode = false;
  updateEditorMode();
  applyEditorContent(formatted, { trackHistory: true });
  toast("已自动排版");
}

function sanitizeChapterTitle(value) {
  const firstLine = String(value || "")
    .split(/\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";

  return firstLine
    .replace(/^#+\s*/, "")
    .replace(/^["'“”‘’《》「」『』]+|["'“”‘’《》「」『』]+$/g, "")
    .replace(/^(第\s*)?[一二三四五六七八九十百千万\d]+\s*[章节回卷部]\s*[:：、.-]?\s*/, "")
    .replace(/^(标题|章节标题)\s*[:：]\s*/, "")
    .trim()
    .slice(0, 32);
}

async function generateChapterTitle() {
  const chapter = currentChapter();
  if (!state.currentWork || !chapter) {
    return;
  }

  if (!els.chapterContentInput.value.trim()) {
    toast("先写一点正文");
    return;
  }

  if (!state.aiConfigured) {
    setAiTab("settings");
    toast("请先配置 AI 或启用本地备用");
    return;
  }

  els.generateTitleButton.disabled = true;

  try {
    const payload = await request("/api/ai/write", {
      method: "POST",
      body: JSON.stringify({
        mode: "title",
        instruction: "为当前章节生成一个贴合剧情、有小说感的章节标题。",
        work: pickWorkContext(),
        chapter: pickChapterContext()
      })
    });
    const title = sanitizeChapterTitle(payload.text);

    if (!title) {
      throw new Error("没有生成可用标题");
    }

    chapter.title = title;
    els.chapterTitleInput.value = title;
    renderChapters();
    await saveChapter({ title });
    toast(payload.fallback ? "已用本地备用生成标题" : "已生成章节标题");
  } catch (error) {
    toast(error.message);
  } finally {
    els.generateTitleButton.disabled = false;
    updateHistoryButtons();
  }
}

async function saveChapter(patch, workId = state.currentWork?.id, chapterId = currentChapter()?.id) {
  const targetWorkId = String(workId || "");
  const targetChapterId = String(chapterId || "");

  if (!targetWorkId || !targetChapterId) {
    return;
  }

  const isCurrentWork = () => state.currentWork?.id === targetWorkId;
  if (isCurrentWork()) {
    setSaveState("保存中");
  }

  const payload = await request(`/api/works/${targetWorkId}/chapters/${targetChapterId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });

  const summaryIndex = state.works.findIndex((item) => item.id === targetWorkId);
  if (summaryIndex >= 0) {
    state.works[summaryIndex] = payload.work;
  }

  if (!isCurrentWork()) {
    renderWorks();
    return payload;
  }

  state.currentWork = payload.work;
  updateSummaryFromCurrentWork();
  renderWorks();
  renderChapters();
  renderStats();
  setSaveState(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
  return payload;
}

async function deleteChapter(chapterId) {
  const work = state.currentWork;
  const chapter = work?.chapters?.find((item) => item.id === chapterId);
  if (!work || !chapter) return;
  if (!window.confirm(`确定删除“${chapter.title || "未命名章节"}”吗？该章节正文无法恢复。`)) return;

  const previousIndex = work.chapters.findIndex((item) => item.id === chapterId);
  const payload = await request(`/api/works/${work.id}/chapters/${chapterId}`, { method: "DELETE" });
  state.currentWork = payload.work;
  const nextChapter = payload.work.chapters?.[Math.min(previousIndex, Math.max(0, (payload.work.chapters?.length || 1) - 1))];
  state.currentChapterId = nextChapter?.id || null;
  rememberWorkspace({ workId: work.id, chapterId: state.currentChapterId || "" });
  updateSummaryFromCurrentWork();
  renderAll();
  toast("章节已删除");
}

function renameChapter(chapterId) {
  const chapter = state.currentWork?.chapters?.find((item) => item.id === chapterId);
  if (!chapter) return;
  state.currentChapterId = chapter.id;
  rememberWorkspace({ chapterId: chapter.id });
  setMainView("create");
  renderChapters();
  renderEditor();
  renderStats();
  els.chapterTitleInput.focus();
  els.chapterTitleInput.select();
  toast("在顶部标题框中输入新章节名");
}

async function saveWork(patch, workId = state.currentWork?.id) {
  const targetWorkId = String(workId || "");
  if (!targetWorkId) {
    return;
  }

  const isCurrentWork = () => state.currentWork?.id === targetWorkId;
  if (isCurrentWork()) {
    setSaveState("保存中");
  }

  const { work } = await request(`/api/works/${targetWorkId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });

  const summaryIndex = state.works.findIndex((item) => item.id === targetWorkId);
  if (summaryIndex >= 0) {
    state.works[summaryIndex] = work;
  }

  if (!isCurrentWork()) {
    renderWorks();
    return work;
  }

  state.currentWork = work;
  updateSummaryFromCurrentWork();
  renderWorks();
  renderStats();
  els.workGenreLabel.textContent = `${work.genre || "原创"} · ${STATUS_LABELS[work.status] || "草稿"}`;
  setSaveState(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
  return work;
}

async function deleteWork(workId) {
  const work = state.works.find((item) => item.id === workId) || state.currentWork;
  if (!work) {
    return;
  }

  const confirmed = window.confirm(`删除《${work.title}》？\n\n此操作会删除该作品的章节和设定库，无法撤回。`);
  if (!confirmed) {
    return;
  }

  await request(`/api/works/${work.id}`, { method: "DELETE" });
  if (state.currentWork?.id === work.id) {
    state.currentWork = null;
    state.currentChapterId = null;
    rememberWorkspace({ workId: "", chapterId: "" });
  }
  await loadWorks();
  toast("作品已删除");
}

async function generateStoryBible() {
  if (!state.currentWork) {
    return;
  }

  const workId = state.currentWork.id;
  const loadVersion = state.workLoadVersion;

  els.premiseGenerateButton.disabled = true;
  els.premiseGenerateButton.textContent = "生成中";
  els.storyBibleStatus.textContent = "正在生成设定库";

  try {
    // 重新生成时只保存当前作品的基础资料，不能把页面上历史残留的设定库重新写回去。
    await saveWork(collectWorkPatch({ includeStoryBible: false }), workId);
    const payload = await request(`/api/works/${workId}/story-bible/generate`, {
      method: "POST",
      body: JSON.stringify({})
    });

    const summaryIndex = state.works.findIndex((item) => item.id === workId);
    if (summaryIndex >= 0) {
      state.works[summaryIndex] = payload.work;
    }

    if (state.currentWork?.id !== workId || state.workLoadVersion !== loadVersion) {
      renderWorks();
      toast("设定库已生成，可返回对应作品查看");
      return;
    }

    state.currentWork = payload.work;
    state.storyBibleQuality = payload.quality || null;
    updateSummaryFromCurrentWork();
    renderWorkDetails();
    renderWorks();
    openMainPanel("bible");
    setSaveState(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    els.storyBibleStatus.textContent = payload.fallback ? "已生成 · 本地备用" : "已生成";
    toast(payload.fallback ? "已用本地备用生成设定库" : "设定库已生成");
  } catch (error) {
    els.storyBibleStatus.textContent = "生成失败";
    toast(error.message);
  } finally {
    els.premiseGenerateButton.disabled = false;
    els.premiseGenerateButton.textContent = "生成设定";
  }
}

async function generateCover() {
  if (!state.currentWork) {
    toast("请先选择作品");
    return;
  }

  const buttons = [els.coverGenerateButton, els.quickCoverGenerateButton].filter(Boolean);
  buttons.forEach((button) => {
    button.disabled = true;
  });
  if (els.coverGenerateButton) {
    els.coverGenerateButton.textContent = "生成中";
  }
  if (els.coverStatus) {
    els.coverStatus.textContent = "正在生成封面";
  }

  try {
    await saveWork({ ...collectWorkPatch(), ...collectCoverLayoutPatch() });
    const payload = await request(`/api/works/${state.currentWork.id}/cover/generate`, {
      method: "POST",
      body: JSON.stringify({
        prompt: els.coverPromptInput?.value || ""
      })
    });
    state.currentWork = payload.work;
    updateSummaryFromCurrentWork();
    renderWorkDetails();
    renderWorks();
    openMainPanel("cover");
    if (els.coverStatus) {
      els.coverStatus.textContent = `AI 图片已生成${payload.model ? ` · ${payload.model}` : ""}`;
    }
    setSaveState(`已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    toast("AI 封面已生成");
  } catch (error) {
    if (els.coverStatus) {
      els.coverStatus.textContent = `图片模型失败：${error.message}`;
    }
    toast(error.message);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
    if (els.coverGenerateButton) {
      els.coverGenerateButton.textContent = "生成封面";
    }
  }
}

function collectCoverLayoutPatch() {
  return {
    coverLogline: els.coverLoglineInput?.value || "",
    coverStyle: {
      palette: els.coverPaletteSelect?.value || "gold",
      titleAlign: els.coverTitleAlignSelect?.value || "left",
      showTitle: els.coverShowTitleInput?.checked !== false,
      showMetadata: els.coverShowMetadataInput?.checked !== false,
      showLogline: els.coverShowLoglineInput?.checked !== false,
      showAuthor: els.coverShowAuthorInput?.checked !== false
    }
  };
}

async function rebuildCoverLayout() {
  const work = state.currentWork;
  if (!work) return;
  els.coverRebuildButton.disabled = true;
  els.coverRebuildButton.textContent = "排版中";
  try {
    await saveWork(collectCoverLayoutPatch());
    const payload = await request(`/api/works/${work.id}/cover/rebuild`, { method: "POST", body: "{}" });
    state.currentWork = payload.work;
    updateSummaryFromCurrentWork();
    renderWorkDetails();
    renderWorks();
    if (els.coverStatus) els.coverStatus.textContent = "已更新封面信息排版";
    toast("已应用封面信息排版");
  } catch (error) {
    toast(error.message);
  } finally {
    els.coverRebuildButton.disabled = false;
    els.coverRebuildButton.textContent = "应用信息排版";
  }
}

async function uploadCover() {
  const file = els.coverUploadInput?.files?.[0];
  if (!state.currentWork) {
    toast("请先选择作品");
    return;
  }
  if (!file) {
    toast("请先选择图片");
    return;
  }
  if (!/^(image\/png|image\/jpeg|image\/webp)$/i.test(file.type)) {
    toast("仅支持 PNG、JPG 或 WebP 图片");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    toast("图片不能超过 25MB");
    return;
  }

  els.coverUploadButton.disabled = true;
  els.coverUploadButton.textContent = "添加中";
  if (els.coverStatus) {
    els.coverStatus.textContent = "正在保存本地图片";
  }

  try {
    await saveWork(collectCoverLayoutPatch());
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(new Error("无法读取所选图片")));
      reader.readAsDataURL(file);
    });
    const payload = await request(`/api/works/${state.currentWork.id}/cover/upload`, {
      method: "POST",
      body: JSON.stringify({ image: dataUrl })
    });
    state.currentWork = payload.work;
    updateSummaryFromCurrentWork();
    renderWorkDetails();
    renderWorks();
    openMainPanel("cover");
    if (els.coverStatus) {
      els.coverStatus.textContent = "本地图片已设为封面";
    }
    toast("封面已添加");
  } catch (error) {
    if (els.coverStatus) {
      els.coverStatus.textContent = `添加失败：${error.message}`;
    }
    toast(error.message);
  } finally {
    els.coverUploadInput.value = "";
    els.coverUploadButton.disabled = false;
    els.coverUploadButton.textContent = "添加本地图片";
  }
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("无法读取所选图片")));
    reader.readAsDataURL(file);
  });
}

function resetChapterImageModal() {
  els.chapterImageCaptionInput.value = "";
  els.chapterImagePromptInput.value = "";
  els.chapterImageUploadInput.value = "";
  els.chapterImageGenerateButton.disabled = false;
  els.chapterImageGenerateButton.textContent = "AI 生成并插入";
  els.chapterImageUploadButton.disabled = false;
  els.chapterImageUploadButton.textContent = "添加本地图片";
  els.chapterImageNote.textContent = "AI 会读取当前章节、设定库、章纲与连续性提醒；也可以直接添加本地图片。";
}

function openChapterImageModal() {
  const chapter = currentChapter();
  if (!state.currentWork || !chapter) {
    toast("请先选择作品和章节");
    return;
  }
  resetChapterImageModal();
  els.chapterImageCaptionInput.value = chapter.title || "章节插图";
  els.chapterImageModal.showModal();
  els.chapterImagePromptInput.focus();
}

async function insertChapterImage(payload) {
  if (!payload?.markdown) {
    throw new Error("没有收到可插入的图片内容");
  }
  if (!insertTextIntoChapter(payload.markdown, { appendWhenNoSelection: true })) {
    throw new Error("无法插入图片，请先选择一个章节");
  }
  await saveChapter({ content: els.chapterContentInput.value });
  toast(payload.source === "ai" ? "AI 插图已生成并插入正文" : "图片已插入正文");
}

async function generateChapterImage() {
  const work = state.currentWork;
  const chapter = currentChapter();
  if (!work || !chapter) {
    return;
  }

  els.chapterImageGenerateButton.disabled = true;
  els.chapterImageGenerateButton.textContent = "生成中";
  els.chapterImageNote.textContent = "正在按本章剧情生成插图…";
  try {
    const payload = await request(`/api/works/${work.id}/chapters/${chapter.id}/images/generate`, {
      method: "POST",
      body: JSON.stringify({
        caption: els.chapterImageCaptionInput.value,
        prompt: els.chapterImagePromptInput.value
      })
    });
    await insertChapterImage(payload);
    els.chapterImageModal.close();
  } catch (error) {
    els.chapterImageNote.textContent = `生成失败：${error.message}`;
    toast(error.message);
  } finally {
    els.chapterImageGenerateButton.disabled = false;
    els.chapterImageGenerateButton.textContent = "AI 生成并插入";
  }
}

async function uploadChapterImage() {
  const work = state.currentWork;
  const chapter = currentChapter();
  const file = els.chapterImageUploadInput.files?.[0];
  if (!work || !chapter || !file) {
    toast("请先选择图片");
    return;
  }
  if (!/^(image\/png|image\/jpeg|image\/webp)$/i.test(file.type)) {
    toast("仅支持 PNG、JPG 或 WebP 图片");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    toast("图片不能超过 25MB");
    return;
  }

  els.chapterImageUploadButton.disabled = true;
  els.chapterImageUploadButton.textContent = "添加中";
  els.chapterImageNote.textContent = "正在保存并插入本地图片…";
  try {
    const payload = await request(`/api/works/${work.id}/chapters/${chapter.id}/images/upload`, {
      method: "POST",
      body: JSON.stringify({
        caption: els.chapterImageCaptionInput.value || file.name.replace(/\.[^.]+$/u, ""),
        image: await readImageFile(file)
      })
    });
    await insertChapterImage(payload);
    els.chapterImageModal.close();
  } catch (error) {
    els.chapterImageNote.textContent = `添加失败：${error.message}`;
    toast(error.message);
  } finally {
    els.chapterImageUploadButton.disabled = false;
    els.chapterImageUploadButton.textContent = "添加本地图片";
    els.chapterImageUploadInput.value = "";
  }
}

async function uploadWallpaper() {
  const file = els.wallpaperUploadInput?.files?.[0];
  if (!file) {
    toast("请先选择图片");
    return;
  }
  if (!/^(image\/png|image\/jpeg|image\/webp)$/i.test(file.type)) {
    toast("壁纸仅支持 PNG、JPG 或 WebP 图片");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    toast("壁纸图片不能超过 25MB");
    return;
  }

  els.wallpaperUploadButton.disabled = true;
  els.wallpaperUploadButton.textContent = "添加中";
  try {
    const payload = await request("/api/wallpapers/upload", {
      method: "POST",
      body: JSON.stringify({
        name: file.name.replace(/\.[^.]+$/u, "") || "自定义壁纸",
        theme: document.body.dataset.theme || "",
        image: await readImageFile(file)
      })
    });
    addCustomWallpaper(payload.wallpaper);
    toast("壁纸已添加并应用");
  } catch (error) {
    toast(error.message);
  } finally {
    els.wallpaperUploadInput.value = "";
    els.wallpaperUploadButton.disabled = false;
    els.wallpaperUploadButton.textContent = "添加图片";
  }
}

async function generateWallpaper() {
  if (!els.wallpaperGenerateButton) {
    return;
  }

  els.wallpaperGenerateButton.disabled = true;
  els.wallpaperGenerateButton.textContent = "生成中";
  try {
    const payload = await request("/api/wallpapers/generate", {
      method: "POST",
      body: JSON.stringify({
        name: state.currentWork ? `${state.currentWork.title} · 作品壁纸` : "AI 生成壁纸",
        theme: document.body.dataset.theme || "",
        prompt: els.wallpaperPromptInput?.value || "",
        workId: state.currentWork?.id || ""
      })
    });
    addCustomWallpaper(payload.wallpaper);
    if (els.wallpaperPromptInput) {
      els.wallpaperPromptInput.value = "";
    }
    toast(state.currentWork ? "已按当前作品生成并应用壁纸" : "AI 壁纸已生成并应用");
  } catch (error) {
    toast(error.message);
  } finally {
    els.wallpaperGenerateButton.disabled = false;
    els.wallpaperGenerateButton.textContent = "生成作品壁纸";
  }
}

function activeHomeArt() {
  const fallback = HOME_ARTS[document.body.dataset.theme] || HOME_ARTS.light;
  const image = localStorage.getItem("motai.homeArt");
  return image
    ? {
      ...fallback,
      image,
      alt: "AI 生成的墨台主页图",
      kicker: "我的主页图",
      title: "属于你的创作空间"
    }
    : fallback;
}

function applyHomeArt() {
  const art = activeHomeArt();
  if (els.homeArtImage) {
    const nextSource = new URL(art.image, window.location.href).href;
    if (els.homeArtImage.src !== nextSource) {
      els.homeArtImage.classList.remove("home-art-refresh");
      els.homeArtImage.src = art.image;
      window.requestAnimationFrame(() => els.homeArtImage?.classList.add("home-art-refresh"));
    }
    els.homeArtImage.alt = art.alt;
  }
  if (els.homeArtKicker) {
    els.homeArtKicker.textContent = art.kicker;
  }
  if (els.homeArtTitle) {
    els.homeArtTitle.textContent = art.title;
  }
  els.homeArtResetButton?.classList.toggle("hidden", !localStorage.getItem("motai.homeArt"));
}

function loadHomeArt() {
  applyHomeArt();
}

function resetHomeArt() {
  localStorage.removeItem("motai.homeArt");
  applyHomeArt();
  toast("已恢复当前主题的主页图");
}

function loadLocalWallpaperPreferences() {
  try {
    state.wallpaper = normalizeWallpaper(JSON.parse(localStorage.getItem("motai.wallpaper") || "{}"));
  } catch {
    state.wallpaper = normalizeWallpaper({});
  }
}

async function generateHomeArt() {
  if (!els.homeArtGenerateButton) {
    return;
  }

  els.homeArtGenerateButton.disabled = true;
  els.homeArtGenerateButton.textContent = "生成中";
  try {
    const payload = await request("/api/site-art", {
      method: "POST",
      body: JSON.stringify({
        prompt: (HOME_ARTS[document.body.dataset.theme] || HOME_ARTS.light).prompt
      })
    });
    if (payload.image && els.homeArtImage) {
      els.homeArtImage.src = payload.image;
      localStorage.setItem("motai.homeArt", payload.image);
      applyHomeArt();
      toast("主页图已由 AI 生成");
    }
  } catch (error) {
    toast(error.message);
  } finally {
    els.homeArtGenerateButton.disabled = false;
    els.homeArtGenerateButton.textContent = "AI 生成主页图";
  }
}

function getSelectedText() {
  const input = els.chapterContentInput;
  return input.value.slice(input.selectionStart, input.selectionEnd);
}

function pickWorkContext() {
  const work = state.currentWork || {};
  return {
    title: work.title,
    premise: work.premise,
    genre: work.genre,
    status: work.status,
    tags: work.tags || [],
    targetCharacters: work.targetCharacters,
    boldness: Number(work.boldness ?? els.boldnessInput.value) || 50,
    storyBible: normalizeStoryBible(work.storyBible)
  };
}

function pickChapterContext() {
  const chapter = currentChapter() || {};
  return {
    title: chapter.title,
    content: els.chapterContentInput.value || chapter.content || "",
    notes: chapter.notes,
    status: chapter.status
  };
}

function setAiBusy(isBusy, mode = "") {
  state.aiBusy = isBusy;
  document.body.classList.toggle("ai-busy", isBusy);
  els.aiActionButtons.forEach((button) => {
    button.disabled = isBusy;
    button.classList.toggle("active", isBusy && button.dataset.aiMode === mode);
    button.setAttribute("aria-busy", String(isBusy && button.dataset.aiMode === mode));
  });
  els.aiInsertButton.disabled = isBusy;
  els.aiOutput.setAttribute("aria-busy", String(isBusy));
  if (isBusy) {
    els.aiStatus.textContent = "生成中";
  } else {
    loadAiStatus();
  }
}

function setAiTab(tab) {
  openMainPanel(tab === "settings" ? "settings" : "write");
}

function findProviderPreset(value) {
  return (state.aiConfig?.providers || []).find((provider) => provider.value === value) || null;
}

function applyProviderPreset() {
  const provider = findProviderPreset(els.aiProviderSelect.value);
  if (!provider) {
    return;
  }

  if (provider.value !== "custom") {
    els.aiBaseUrlInput.value = provider.baseUrl || "";
    els.aiModelInput.value = provider.model || "";
    els.aiEndpointSelect.value = provider.endpoint || "chat";
  }

  if (provider.value === "local") {
    els.aiKeyInput.value = "";
  }

  els.aiConfigNote.textContent = AI_PROVIDER_HINTS[provider.value] || "";
}

function collectAiConfigForm() {
  return {
    provider: els.aiProviderSelect.value,
    apiKey: els.aiKeyInput.value.trim(),
    baseUrl: els.aiBaseUrlInput.value.trim(),
    model: els.aiModelInput.value.trim(),
    endpoint: els.aiEndpointSelect.value,
    maxOutputTokens: Number(els.aiMaxTokensInput.value) || 3200,
    timeoutMs: Number(els.aiTimeoutInput.value) || 30000,
    imageApiKey: els.imageKeyInput.value.trim(),
    imageBaseUrl: els.imageBaseUrlInput.value.trim(),
    imageModel: els.imageModelInput.value.trim(),
    imageTimeoutMs: Number(els.imageTimeoutInput.value) || 60000,
    proxy: els.aiProxyInput.value.trim(),
    localFallback: els.aiFallbackInput.checked
  };
}

async function saveAiConfig(showToast = true) {
  els.aiSaveConfigButton.disabled = true;
  els.aiSaveConfigButton.textContent = "保存中";

  try {
    const { config } = await request("/api/ai/config", {
      method: "POST",
      body: JSON.stringify(collectAiConfigForm())
    });
    applyAiConfig(config);
    els.aiConfigNote.textContent = "已保存。";
    if (showToast) {
      toast("AI 设置已保存");
    }
    return config;
  } finally {
    els.aiSaveConfigButton.disabled = false;
    els.aiSaveConfigButton.textContent = "保存";
  }
}

async function testAiConfig() {
  els.aiTestConfigButton.disabled = true;
  els.aiTestConfigButton.textContent = "测试中";

  try {
    await saveAiConfig(false);
    const result = await request("/api/ai/test", { method: "POST", body: JSON.stringify({}) });
    els.aiConfigNote.textContent = result.message || (result.ok ? "连接成功。" : "连接失败。");
    toast(result.ok ? "连接成功" : "连接失败");
  } finally {
    els.aiTestConfigButton.disabled = false;
    els.aiTestConfigButton.textContent = "测试";
  }
}

async function runAi(mode) {
  if (!state.currentWork || !currentChapter()) {
    return;
  }

  if (!state.aiConfigured) {
    const message = "请先打开 AI 设置，选择接口并保存。";
    els.aiOutput.value = message;
    state.aiOutputInsertable = false;
    setAiTab("settings");
    toast("请先配置 AI");
    await loadAiStatus();
    return;
  }

  setAiBusy(true, mode);
  els.aiOutput.value = "";
  state.aiOutputInsertable = false;

  try {
    const payload = await request("/api/ai/write", {
      method: "POST",
      body: JSON.stringify({
        mode,
        instruction: els.aiInstructionInput.value,
        selectedText: getSelectedText(),
        work: pickWorkContext(),
        chapter: pickChapterContext()
      })
    });

    els.aiOutput.value = payload.text || "";
    state.aiOutputInsertable = Boolean(payload.text);
    const inserted = maybeAutoInsertAiOutput(mode);
    if (inserted) {
      state.aiOutputInsertable = false;
    }
    toast(inserted
      ? (payload.fallback ? "已插入本地备用内容" : "已插入正文")
      : (payload.fallback ? "已生成本地备用内容" : "AI 已生成"));
    if (payload.fallback) {
      els.aiStatus.textContent = "本地备用结果";
    }
  } catch (error) {
    els.aiOutput.value = error.message;
    state.aiOutputInsertable = false;
    toast(error.message);
  } finally {
    setAiBusy(false);
  }
}

function extractInsertableAiText(text) {
  const raw = String(text || "").trim();
  const markers = ["【正文草稿】", "【润色文本】", "【可执行内容】"];
  for (const marker of markers) {
    const index = raw.indexOf(marker);
    if (index >= 0) {
      return raw.slice(index + marker.length).trim();
    }
  }
  return raw;
}

function insertTextIntoChapter(text, options = {}) {
  const chapter = currentChapter();
  if (!chapter || !text) {
    return false;
  }

  state.previewMode = false;
  updateEditorMode();

  const input = els.chapterContentInput;
  const hasSelection = input.selectionStart !== input.selectionEnd;
  const shouldAppend = options.append || (options.appendWhenNoSelection && !hasSelection);

  if (shouldAppend) {
    input.selectionStart = input.value.length;
    input.selectionEnd = input.value.length;
  }

  const start = input.selectionStart;
  const end = input.selectionEnd;
  const prefix = start > 0 && !input.value.slice(0, start).endsWith("\n") ? "\n\n" : "";
  const suffix = end < input.value.length && !input.value.slice(end).startsWith("\n") ? "\n\n" : "";
  input.setRangeText(`${prefix}${text}${suffix}`, start, end, "end");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  return true;
}

function maybeAutoInsertAiOutput(mode) {
  if (!AUTO_INSERT_AI_MODES.has(mode) || !state.aiOutputInsertable) {
    return false;
  }

  const text = extractInsertableAiText(els.aiOutput.value);
  if (!text) {
    return false;
  }

  return insertTextIntoChapter(text, {
    append: mode === "continue",
    appendWhenNoSelection: mode === "custom"
  });
}

function insertAiOutput() {
  const text = extractInsertableAiText(els.aiOutput.value);
  if (!text || !state.aiOutputInsertable) {
    if (text) {
      toast("当前内容不是可插入的生成结果");
    }
    return;
  }

  if (insertTextIntoChapter(text)) {
    toast("已插入正文");
  }
}

function updateSummaryFromCurrentWork() {
  const work = state.currentWork;
  const index = state.works.findIndex((item) => item.id === work.id);
  const summary = {
    id: work.id,
    title: work.title,
    author: work.author || "未署名",
    premise: work.premise,
    genre: work.genre,
    status: work.status,
    tags: work.tags || [],
    targetCharacters: work.targetCharacters || 0,
    boldness: Number(work.boldness ?? 50),
    storyBible: normalizeStoryBible(work.storyBible),
    coverStyle: work.coverStyle || {},
    coverLogline: work.coverLogline || "",
    cover: work.cover,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    stats: {
      totalCharacters: work.chapters.reduce((sum, chapter) => sum + countCharacters(chapter.content), 0),
      chapterCount: work.chapters.length,
      completedChapters: work.chapters.filter((chapter) => chapter.status === "done").length,
      progress: work.targetCharacters
        ? Math.min(100, Math.round((work.chapters.reduce((sum, chapter) => sum + countCharacters(chapter.content), 0) / work.targetCharacters) * 100))
        : 0
    }
  };

  if (index >= 0) {
    state.works[index] = summary;
  } else {
    state.works.unshift(summary);
  }
}

const debouncedChapterSave = debounce((patch, workId, chapterId) => {
  saveChapter(patch, workId, chapterId).catch((error) => {
    if (state.currentWork?.id === workId) {
      setSaveState("保存失败");
      toast(error.message);
    }
  });
}, 650);

const debouncedWorkSave = debounce((patch, workId) => {
  saveWork(patch, workId).catch((error) => {
    if (state.currentWork?.id === workId) {
      setSaveState("保存失败");
      toast(error.message);
    }
  });
}, 650);

function bindEvents() {
  document.addEventListener("pointerdown", addClickPulse);
  els.themeToggleButton?.addEventListener("click", toggleThemeMenu);
  els.wallpaperToggleButton?.addEventListener("click", () => setWallpaperMenuOpen(!els.wallpaperMenu?.classList.contains("open")));
  els.wallpaperCloseButton?.addEventListener("click", () => setWallpaperMenuOpen(false));
  els.wallpaperBuiltinChoices?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-wallpaper-id]");
    if (button) {
      selectWallpaper(button.dataset.wallpaperId);
    }
  });
  els.wallpaperCustomChoices?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-wallpaper-id]");
    if (button) {
      selectWallpaper(button.dataset.wallpaperId);
    }
  });
  els.wallpaperOpacityInput?.addEventListener("input", () => {
    state.wallpaper = normalizeWallpaper({ ...state.wallpaper, opacity: els.wallpaperOpacityInput.value });
    applyWallpaper();
  });
  els.wallpaperUploadButton?.addEventListener("click", () => els.wallpaperUploadInput?.click());
  els.wallpaperUploadInput?.addEventListener("change", uploadWallpaper);
  els.wallpaperGenerateButton?.addEventListener("click", generateWallpaper);
  els.themeOptionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeOption);
      setThemeMenuOpen(false);
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#themePicker")) {
      setThemeMenuOpen(false);
    }
    if (!event.target.closest("#wallpaperPicker")) {
      setWallpaperMenuOpen(false);
    }
    if (!event.target.closest("#exportPicker")) {
      setExportMenuOpen(false);
    }
  });
  els.exportToggleButton?.addEventListener("click", toggleExportMenu);
  els.exportOptionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyExportFormat(button.dataset.exportFormat);
      setExportMenuOpen(false);
    });
  });
  els.homeArtGenerateButton?.addEventListener("click", generateHomeArt);
  els.homeArtResetButton?.addEventListener("click", resetHomeArt);
  els.mainPanelCloseButton?.addEventListener("click", closeMainPanel);
  els.mainViewButtons.forEach((button) => {
    button.addEventListener("click", () => setMainView(button.dataset.mainView));
  });
  els.toolbarCustomizeButton?.addEventListener("click", () => {
    els.toolbarCustomizePanel?.classList.toggle("hidden");
  });

  els.openMainPanelButtons.forEach((button) => {
    button.addEventListener("click", () => openMainPanel(button.dataset.openMainPanel));
  });

  els.toolbarToggles.forEach((input) => {
    input.addEventListener("change", () => {
      state.toolbarPrefs[input.dataset.toolbarToggle] = input.checked;
      saveToolbarPrefs();
      applyToolbarPrefs();
    });
  });

  els.toolbarActions.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.toolbarAction === "generate-bible") {
        generateStoryBible();
      }
    });
  });

  els.workList.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-work-id]");
    if (deleteButton) {
      event.stopPropagation();
      await deleteWork(deleteButton.dataset.deleteWorkId);
      return;
    }

    const card = event.target.closest("[data-work-id]");
    if (!card) {
      return;
    }
    state.currentChapterId = null;
    rememberWorkspace({ chapterId: "" });
    await loadWork(card.dataset.workId);
  });

  els.workList.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (event.target.closest("[data-delete-work-id]")) {
      return;
    }
    const card = event.target.closest("[data-work-id]");
    if (!card) {
      return;
    }
    event.preventDefault();
    state.currentChapterId = null;
    rememberWorkspace({ chapterId: "" });
    await loadWork(card.dataset.workId);
  });

  els.chapterList.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-chapter-id]");
    if (deleteButton) {
      event.stopPropagation();
      try {
        await deleteChapter(deleteButton.dataset.deleteChapterId);
      } catch (error) {
        toast(error.message);
      }
      return;
    }

    const renameButton = event.target.closest("[data-rename-chapter-id]");
    if (renameButton) {
      event.stopPropagation();
      renameChapter(renameButton.dataset.renameChapterId);
      return;
    }

    const card = event.target.closest("[data-chapter-id]");
    if (!card) {
      return;
    }
    state.currentChapterId = card.dataset.chapterId;
    rememberWorkspace({ chapterId: state.currentChapterId });
    renderChapters();
    renderEditor();
    renderStats();
  });

  els.chapterBoard?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-board-chapter-id]");
    if (!card) return;
    state.currentChapterId = card.dataset.boardChapterId;
    rememberWorkspace({ chapterId: state.currentChapterId });
    renderChapters();
    renderEditor();
    renderStats();
    openMainPanel("write");
  });

  els.workSearch.addEventListener("input", () => {
    state.search = els.workSearch.value;
    renderWorks();
  });

  els.newWorkButton.addEventListener("click", () => {
    els.newWorkForm.reset();
    els.newWorkAuthor.value = "未署名";
    els.newWorkGenre.value = "原创";
    els.newWorkChapterTitle.value = "第一章";
    els.newWorkTarget.value = "80000";
    els.newWorkModal.showModal();
    els.newWorkTitle.focus();
  });

  const closeNewWorkModal = () => {
    els.newWorkForm.reset();
    els.newWorkModal.close();
  };

  els.closeNewWorkButton.addEventListener("click", closeNewWorkModal);
  els.cancelNewWorkButton.addEventListener("click", closeNewWorkModal);
  els.newWorkModal.addEventListener("close", () => {
    els.createWorkSubmit.disabled = false;
    els.createWorkSubmit.textContent = "创建";
  });

  els.newWorkForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = els.newWorkTitle.value.trim();

    if (!title) {
      toast("请先填写作品标题");
      els.newWorkTitle.focus();
      return;
    }

    els.createWorkSubmit.disabled = true;
    els.createWorkSubmit.textContent = "创建中";

    try {
      const { work } = await request("/api/works", {
        method: "POST",
        body: JSON.stringify({
          title,
          author: els.newWorkAuthor.value,
          genre: els.newWorkGenre.value,
          premise: els.newWorkPremise.value,
          chapterTitle: els.newWorkChapterTitle.value,
          targetCharacters: Number(els.newWorkTarget.value) || 80000,
          tags: parseTags(els.newWorkTags.value)
        })
      });

      els.newWorkModal.close();
      state.currentChapterId = work.chapters[0]?.id;
      await loadWorks(work.id);
      els.newWorkForm.reset();
      toast("作品已创建");
    } catch (error) {
      toast(error.message);
    } finally {
      els.createWorkSubmit.disabled = false;
      els.createWorkSubmit.textContent = "创建";
    }
  });

  els.addChapterButton.addEventListener("click", async () => {
    if (!state.currentWork) {
      return;
    }

    const { chapter, work } = await request(`/api/works/${state.currentWork.id}/chapters`, {
      method: "POST",
      body: JSON.stringify({})
    });

    state.currentWork = work;
    state.currentChapterId = chapter.id;
    rememberWorkspace({ workId: work.id, chapterId: chapter.id });
    updateSummaryFromCurrentWork();
    renderAll();
    toast("章节已新增");
  });

  els.chapterContentInput.addEventListener("input", () => {
    const chapter = currentChapter();
    const workId = state.currentWork?.id;
    if (!chapter || !workId) {
      return;
    }

    rememberEditorValue(els.chapterContentInput.value);
    chapter.content = els.chapterContentInput.value;
    els.chapterPreview.innerHTML = renderChapterPreview(chapter.content);
    setSaveState("未保存");
    renderStats();
    renderChapters();
    debouncedChapterSave({ content: chapter.content }, workId, chapter.id);
  });

  els.chapterTitleInput.addEventListener("input", () => {
    const chapter = currentChapter();
    const workId = state.currentWork?.id;
    if (!chapter || !workId) {
      return;
    }

    chapter.title = els.chapterTitleInput.value;
    setSaveState("未保存");
    renderChapters();
    debouncedChapterSave({ title: chapter.title }, workId, chapter.id);
  });

  els.chapterStatusSelect.addEventListener("change", () => {
    const chapter = currentChapter();
    const workId = state.currentWork?.id;
    if (!chapter || !workId) {
      return;
    }

    chapter.status = els.chapterStatusSelect.value;
    renderChapters();
    debouncedChapterSave({ status: chapter.status }, workId, chapter.id);
  });

  els.workTitleInput.addEventListener("input", () => {
    const workId = state.currentWork?.id;
    if (!workId) {
      return;
    }
    state.currentWork.title = els.workTitleInput.value;
    setSaveState("未保存");
    updateSummaryFromCurrentWork();
    renderWorks();
    debouncedWorkSave({ title: els.workTitleInput.value }, workId);
  });

  for (const element of [els.authorInput, els.genreInput, els.workStatusSelect, els.targetInput, els.boldnessInput, els.tagsInput, els.premiseInput]) {
    element.addEventListener("input", () => {
      const workId = state.currentWork?.id;
      if (!workId) {
        return;
      }
      if (element === els.boldnessInput) {
        els.boldnessValue.textContent = `${els.boldnessInput.value} · ${getBoldnessLabel(els.boldnessInput.value)}`;
      }
      const patch = collectWorkPatch();
      Object.assign(state.currentWork, patch);
      setSaveState("未保存");
      debouncedWorkSave(patch, workId);
    });

    element.addEventListener("change", () => {
      const workId = state.currentWork?.id;
      if (!workId) {
        return;
      }
      const patch = collectWorkPatch();
      Object.assign(state.currentWork, patch);
      if (element === els.boldnessInput) {
        els.boldnessValue.textContent = `${els.boldnessInput.value} · ${getBoldnessLabel(els.boldnessInput.value)}`;
      }
      debouncedWorkSave(patch, workId);
    });
  }

  els.storyBibleInputs.forEach((input) => {
    input.addEventListener("input", () => {
      const workId = state.currentWork?.id;
      if (!workId) {
        return;
      }
      const storyBible = collectStoryBible();
      state.currentWork.storyBible = storyBible;
      renderCharacterMap(storyBible);
      setSaveState("未保存");
      debouncedWorkSave({
        storyBible,
        boldness: Number(els.boldnessInput.value) || 50
      }, workId);
    });
  });

  els.premiseGenerateButton.addEventListener("click", generateStoryBible);
  els.storyQualityCheckButton?.addEventListener("click", checkStoryBibleQuality);
  els.storyRoadmapCheckButton?.addEventListener("click", checkStoryBibleQuality);
  for (const container of [els.storyRoadmapSteps, els.storyQualityIssues]) {
    container?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-story-guide-action]");
      if (!button) return;
      handleStoryGuideAction(button.dataset.storyGuideAction).catch((error) => toast(error.message));
    });
  }
  els.addCharacterCardButton?.addEventListener("click", () => {
    runStructuredActionOnce(() => {
      const storyBible = collectStoryBible();
      const cards = parseCharacterCards(storyBible.characters);
      cards.push({ name: "新人物", identity: "待补充身份与立场", goal: "", secret: "", arc: "" });
      storyBible.characters = characterCardsToText(cards);
      persistStructuredStoryBible(storyBible);
      renderStructuredCharacters(storyBible);
    });
  });
  els.addRelationshipCardButton?.addEventListener("click", () => {
    runStructuredActionOnce(() => {
      const storyBible = collectStoryBible();
      const characters = parseCharacterCards(storyBible.characters);
      const cards = parseRelationshipCards(storyBible.relationships);
      cards.push({ from: characters[0]?.name || "人物 A", to: characters[1]?.name || "人物 B", type: "关联", status: "", conflict: "" });
      storyBible.relationships = relationshipCardsToText(cards);
      persistStructuredStoryBible(storyBible);
      renderStructuredCharacters(storyBible);
    });
  });
  els.characterCardList?.addEventListener("input", updateStructuredCharacterCard);
  els.characterCardList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-character-card]");
    if (!button) return;
    const storyBible = collectStoryBible();
    const cards = parseCharacterCards(storyBible.characters);
    cards.splice(Number(button.dataset.removeCharacterCard), 1);
    storyBible.characters = characterCardsToText(cards);
    persistStructuredStoryBible(storyBible);
    renderStructuredCharacters(storyBible);
  });
  els.relationshipCardList?.addEventListener("input", updateStructuredRelationshipCard);
  els.relationshipCardList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-relationship-card]");
    if (!button) return;
    const storyBible = collectStoryBible();
    const cards = parseRelationshipCards(storyBible.relationships);
    cards.splice(Number(button.dataset.removeRelationshipCard), 1);
    storyBible.relationships = relationshipCardsToText(cards);
    persistStructuredStoryBible(storyBible);
    renderStructuredCharacters(storyBible);
  });
  const chapterPlanningInputs = [els.chapterGoalInput, els.chapterSceneInput, els.chapterCharactersInput, els.chapterConflictInput, els.chapterHookInput].filter(Boolean);
  chapterPlanningInputs.forEach((input) => input.addEventListener("input", () => {
    const chapter = currentChapter();
    const workId = state.currentWork?.id;
    if (!chapter || !workId) return;
    const planning = {
      goal: els.chapterGoalInput?.value || "",
      scene: els.chapterSceneInput?.value || "",
      characters: els.chapterCharactersInput?.value || "",
      conflict: els.chapterConflictInput?.value || "",
      hook: els.chapterHookInput?.value || ""
    };
    chapter.planning = planning;
    setSaveState("未保存");
    renderChapterBoard();
    debouncedChapterSave({ planning }, workId, chapter.id);
  }));
  els.coverUploadButton?.addEventListener("click", () => els.coverUploadInput?.click());
  els.coverUploadInput?.addEventListener("change", uploadCover);
  els.coverGenerateButton?.addEventListener("click", generateCover);
  els.quickCoverGenerateButton?.addEventListener("click", generateCover);
  els.coverRebuildButton?.addEventListener("click", rebuildCoverLayout);
  els.coverHistoryList?.addEventListener("click", (event) => selectCoverHistory(event.target.closest("[data-cover-history-id]")?.dataset.coverHistoryId));
  els.quickCoverHistory?.addEventListener("click", (event) => selectCoverHistory(event.target.closest("[data-cover-history-id]")?.dataset.coverHistoryId));
  els.insertIllustrationButton?.addEventListener("click", openChapterImageModal);
  els.closeChapterImageButton?.addEventListener("click", () => els.chapterImageModal.close());
  els.chapterImageModal?.addEventListener("close", resetChapterImageModal);
  els.chapterImageForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    generateChapterImage();
  });
  els.chapterImageUploadButton?.addEventListener("click", () => els.chapterImageUploadInput.click());
  els.chapterImageUploadInput?.addEventListener("change", uploadChapterImage);

  els.writeModeButton.addEventListener("click", () => {
    state.previewMode = false;
    rememberWorkspace({ previewMode: false });
    updateEditorMode();
  });

  els.previewModeButton.addEventListener("click", () => {
    state.previewMode = true;
    rememberWorkspace({ previewMode: true });
    els.chapterPreview.innerHTML = renderChapterPreview(currentChapter()?.content || "");
    updateEditorMode();
  });

  els.undoButton.addEventListener("click", undoEditor);
  els.redoButton.addEventListener("click", redoEditor);
  els.formatChapterButton.addEventListener("click", autoFormatChapter);
  els.generateTitleButton.addEventListener("click", generateChapterTitle);

  els.aiProviderSelect.addEventListener("change", applyProviderPreset);
  els.aiSettingsPane.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveAiConfig(true);
      setAiTab("write");
    } catch (error) {
      els.aiConfigNote.textContent = error.message;
      toast(error.message);
    }
  });
  els.aiTestConfigButton.addEventListener("click", async () => {
    try {
      await testAiConfig();
    } catch (error) {
      els.aiConfigNote.textContent = error.message;
      toast(error.message);
    }
  });

  els.aiActionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      runAi(button.dataset.aiMode);
    });
  });

  els.aiInsertButton.addEventListener("click", insertAiOutput);

  els.exportButton.addEventListener("click", exportWork);
  els.backupExportButton?.addEventListener("click", exportBackup);
  els.backupRestoreButton?.addEventListener("click", () => els.backupRestoreInput?.click());
  els.backupRestoreInput?.addEventListener("change", () => {
    const file = els.backupRestoreInput.files?.[0];
    els.backupRestoreInput.value = "";
    restoreBackup(file);
  });

  els.shutdownButton.addEventListener("click", async () => {
    const desktopMode = document.body.dataset.runtime === "desktop";
    const confirmed = window.confirm(
      desktopMode
        ? "退出墨台？未保存的内容可能丢失。"
        : "关闭墨台服务？关闭后刷新页面会无法访问，需要重新双击打开。"
    );
    if (!confirmed) {
      return;
    }

    try {
      const result = await request("/api/system/shutdown", { method: "POST" });
      if (result.desktop) {
        window.close();
        return;
      }
      toast("服务已关闭");
      setTimeout(() => {
        document.body.innerHTML = `<main class="closed-screen"><h1>墨台已关闭</h1><p>需要继续写作时，重新双击“打开墨台.vbs”。</p></main>`;
      }, 300);
    } catch (error) {
      toast(error.message);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && els.themeMenu?.classList.contains("open")) {
      setThemeMenuOpen(false);
      els.themeToggleButton?.focus();
      return;
    }
    if (event.key === "Escape" && els.exportMenu?.classList.contains("open")) {
      setExportMenuOpen(false);
      els.exportToggleButton?.focus();
      return;
    }

    const key = event.key.toLowerCase();
    const isEditorFocused = document.activeElement === els.chapterContentInput;
    const isUndo = isEditorFocused && (event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey;
    const isRedo = isEditorFocused && (event.ctrlKey || event.metaKey) && (key === "y" || (key === "z" && event.shiftKey));
    if (isUndo || isRedo) {
      event.preventDefault();
      if (isUndo) {
        undoEditor();
      } else {
        redoEditor();
      }
      return;
    }

    const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
    if (!isSave) {
      return;
    }

    event.preventDefault();
    const chapter = currentChapter();
    if (chapter) {
      saveChapter({
        title: els.chapterTitleInput.value,
        content: els.chapterContentInput.value,
        status: els.chapterStatusSelect.value
      }).catch((error) => toast(error.message));
    }
  });
}

function collectWorkPatch(options = {}) {
  const patch = {
    author: els.authorInput.value,
    genre: els.genreInput.value,
    status: els.workStatusSelect.value,
    targetCharacters: Number(els.targetInput.value) || 0,
    boldness: Number(els.boldnessInput.value) || 50,
    tags: parseTags(els.tagsInput.value),
    premise: els.premiseInput.value
  };

  if (options.includeStoryBible !== false) {
    patch.storyBible = collectStoryBible();
  }

  return patch;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function fileNameFromDisposition(disposition, fallback) {
  const value = String(disposition || "");
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return fallback;
    }
  }
  const quoted = value.match(/filename="([^"]+)"/i);
  return quoted?.[1] || fallback;
}

async function exportWork() {
  const work = state.currentWork;
  if (!work) {
    return;
  }

  const format = els.exportFormatSelect?.value || "markdown";
  els.exportButton.disabled = true;
  try {
    const response = await fetch(`/api/works/${encodeURIComponent(work.id)}/export?format=${encodeURIComponent(format)}`);
    if (!response.ok) {
      let message = "导出失败";
      try {
        const payload = await response.json();
        message = payload.error || message;
      } catch {
        message = await response.text() || message;
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const extension = { markdown: "md", txt: "txt", html: "html", doc: "doc", pdf: "pdf" }[format] || format;
    const fallback = `${work.title || "novel"}.${extension}`;
    downloadBlob(blob, fileNameFromDisposition(response.headers.get("content-disposition"), fallback));
    toast("作品已导出");
  } catch (error) {
    toast(error.message);
  } finally {
    els.exportButton.disabled = false;
  }
}

async function exportBackup() {
  if (!els.backupExportButton) {
    return;
  }

  els.backupExportButton.disabled = true;
  els.backupExportButton.textContent = "正在备份";
  if (els.backupNote) {
    els.backupNote.textContent = "正在整理作品与本地封面…";
  }

  try {
    const response = await fetch("/api/backup");
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "备份导出失败");
    }

    const blob = await response.blob();
    downloadBlob(blob, fileNameFromDisposition(response.headers.get("content-disposition"), "墨台备份.motai-backup.json"));
    if (els.backupNote) {
      els.backupNote.textContent = "备份已下载。文件不含 API Key。";
    }
    toast("完整备份已导出");
  } catch (error) {
    if (els.backupNote) {
      els.backupNote.textContent = `备份失败：${error.message}`;
    }
    toast(error.message);
  } finally {
    els.backupExportButton.disabled = false;
    els.backupExportButton.textContent = "导出完整备份";
  }
}

async function loadAutomaticBackupStatus() {
  if (!els.backupNote) return;
  try {
    const payload = await request("/api/backup/status");
    const automatic = payload.automatic;
    if (!automatic?.lastBackup) {
      els.backupNote.textContent = `自动备份已开启：首次保存后会创建快照，保留最近 ${automatic?.retention || 7} 份。`;
      return;
    }
    const time = new Date(automatic.lastBackup.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    els.backupNote.textContent = `自动备份：${time}，本地保留 ${automatic.count}/${automatic.retention} 份；完整备份不含 API Key。`;
  } catch {
    // 备份状态不应阻断写作界面。
  }
}

async function restoreBackup(file) {
  if (!file) {
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    const message = "备份文件超过 50MB，无法恢复。";
    if (els.backupNote) {
      els.backupNote.textContent = message;
    }
    toast(message);
    return;
  }

  const confirmed = window.confirm("恢复会替换当前作品库。系统会先在本机创建一份恢复前备份，是否继续？");
  if (!confirmed) {
    return;
  }

  els.backupRestoreButton.disabled = true;
  els.backupRestoreButton.textContent = "正在恢复";
  if (els.backupNote) {
    els.backupNote.textContent = "正在校验并恢复备份…";
  }

  try {
    const payload = await JSON.parse(await file.text());
    const result = await request("/api/backup/restore", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.currentWork = null;
    state.currentChapterId = null;
    rememberWorkspace({ workId: "", chapterId: "" });
    await loadWorks();
    if (els.backupNote) {
      els.backupNote.textContent = `恢复完成：${result.workCount} 部作品、${result.coverCount} 张封面。恢复前备份：${result.previousBackup}`;
    }
    toast("备份已恢复");
  } catch (error) {
    if (els.backupNote) {
      els.backupNote.textContent = `恢复失败：${error.message}`;
    }
    toast(error.message);
  } finally {
    els.backupRestoreButton.disabled = false;
    els.backupRestoreButton.textContent = "恢复备份";
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

async function init() {
  mountMainPanels();
  loadLocalWallpaperPreferences();
  applyTheme(localStorage.getItem("motai.theme") || "light");
  applyExportFormat(localStorage.getItem("motai.exportFormat") || els.exportFormatSelect?.value || "markdown");
  loadHomeArt();
  loadToolbarPrefs();
  applyToolbarPrefs();
  bindEvents();
  try {
    const runtime = await request("/api");
    if (runtime.desktop) {
      document.body.dataset.runtime = "desktop";
      els.shutdownButton.title = "退出墨台";
      els.shutdownButton.setAttribute("aria-label", "退出墨台");
    }
    await loadUiPreferences();
    // Start every new app session from the landing page. The last work and
    // chapter stay restored in memory, ready for the author after they enter.
    state.mainView = "home";
    state.restoredWorkspace = { ...state.restoredWorkspace, mainView: "home" };
    setMainView("home");
    await loadAiStatus();
    await loadWorks(state.restoredWorkspace.workId);
    await loadAutomaticBackupStatus();
  } catch (error) {
    setMainView("home");
    toast(error.message);
  }
}

init();
