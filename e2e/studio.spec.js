// Legacy workspace (public/, served at /). Selectors use data-testid and state
// attributes only — never interface copy or colours — so the UI text and theme
// can change without breaking these tests. Text typed or mocked by the test
// itself (test data) may still be asserted.
const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const brand = require("../shared/brand.json");

const evidenceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-legacy-"));
const pageErrors = new WeakMap();
const id = (page, testId) => page.getByTestId(testId);

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const screenshot = path.join(evidenceDirectory, `flow-${testInfo.line}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  console.log(`UI evidence: ${screenshot}`);
  await expect(page).toHaveURL(/http:\/\/127\.0\.0\.1:\d+\//);
  await expect(page).toHaveTitle(new RegExp(Object.values(brand.name).join("|")));
  await expect(page.locator("body")).not.toBeEmpty();
  expect(pageErrors.get(page), "No browser console warnings/errors or uncaught exceptions").toEqual([]);
});

test("workspace: AI chat, story-material draft and rich-text writing", async ({ page, request }) => {
  // This flow starts from an empty library. Other specs share the same
  // temporary database, so remove whatever they created first.
  const { works } = await (await request.get("/api/works")).json();
  for (const work of works) expect((await request.delete(`/api/works/${work.id}`)).ok()).toBeTruthy();
  await page.goto("/");
  await expect(id(page, "ai-availability-button")).toHaveAttribute("data-status", "available");
  await expect(id(page, "nav-ai")).toHaveAttribute("aria-current", "page");
  await expect(id(page, "send-chat-button")).toBeDisabled();

  await id(page, "settings-button").click();
  const settings = id(page, "settings-dialog");
  await expect(settings).toBeVisible();
  await expect(id(page, "ai-model-select")).toBeVisible();
  await expect(settings.locator("input")).toHaveCount(0);
  await expect(id(page, "ai-provider-status-list")).toBeVisible();
  await expect(id(page, "ai-provider-status")).toHaveCount(2);
  await expect(settings.locator("details")).toHaveCount(0);
  await expect(id(page, "ai-model-select").locator("option")).toHaveCount(2);
  await id(page, "ai-model-select").selectOption("openai::gpt-5.5");
  await expect(id(page, "settings-status")).toContainText("gpt-5.5");
  await settings.getByTestId("dialog-close").first().click();

  await id(page, "nav-editor").click();
  await expect(id(page, "add-chapter-button")).toBeDisabled();
  await expect(id(page, "chapter-title-input")).toBeDisabled();
  await expect(id(page, "toggle-editor-ai-button")).toBeDisabled();
  await id(page, "nav-ai").click();

  await id(page, "project-switcher").click();
  await id(page, "new-work-menu-button").click();
  await id(page, "new-work-title").fill("新工作台测试小说");
  await id(page, "new-work-premise").fill("一名守灯人在雾港收到未来寄来的求救信。 ");
  await id(page, "new-work-submit").click();
  await expect(id(page, "current-work-title")).toHaveText("新工作台测试小说");

  await id(page, "chat-input").fill("帮我梳理这个故事的核心冲突");
  await id(page, "send-chat-button").click();
  const assistantReplies = page.locator('[data-testid="chat-message"][data-role="assistant"] [data-testid="chat-message-body"]');
  await expect(assistantReplies.last()).not.toBeEmpty();

  await id(page, "generate-artifact-outline").first().click();
  await expect(id(page, "proposal-dialog")).toBeVisible();
  const proposalChecks = id(page, "proposal-section-checkbox");
  await expect(proposalChecks.first()).toBeChecked();
  for (let index = 0; index < await proposalChecks.count(); index += 1) {
    await proposalChecks.nth(index).uncheck();
  }
  await expect(id(page, "proposal-submit")).toBeDisabled();
  await proposalChecks.first().check();
  await expect(id(page, "proposal-submit")).toBeEnabled();
  await id(page, "proposal-submit").click();
  await expect(id(page, "toast")).toBeVisible();
  await expect(id(page, "proposal-dialog")).toBeHidden();

  await id(page, "open-proposal").first().click();
  await expect(id(page, "proposal-submit")).toBeEnabled();
  await expect(proposalChecks.first()).toBeChecked();
  await expect(proposalChecks.first()).toHaveAttribute("data-readonly", "true");
  await page.locator('[data-testid="proposal-section"].readonly').first().click();
  await expect(id(page, "toast")).toBeVisible();
  await expect(proposalChecks.first()).toBeChecked();
  await id(page, "proposal-submit").click();
  await expect(id(page, "toast")).toBeVisible();
  await id(page, "proposal-dialog").getByTestId("dialog-close").first().click();

  await id(page, "nav-library").click();
  await expect(id(page, "library-title")).toHaveAttribute("data-artifact", "outline");
  await id(page, "edit-library-button").click();
  await expect(id(page, "library-field-logline")).not.toHaveValue("");

  await id(page, "nav-editor").click();
  const editor = id(page, "rich-editor").locator(".ql-editor");
  await editor.click();
  await page.keyboard.type("雾从海面一直漫到守灯塔的窗下。", { delay: 12 });
  await expect(id(page, "editor-save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });

  await id(page, "toggle-editor-ai-button").click();
  await expect(id(page, "editor-ai-instruction")).toBeVisible();
  await id(page, "editor-ai-mode").selectOption("continue");
  await id(page, "editor-ai-instruction").fill("让未来求救信立刻带来新的行动压力，不要总结。 ");
  let writeRequestBody;
  await page.route("**/api/tasks", async (route) => {
    writeRequestBody = route.request().postDataJSON();
    if (writeRequestBody.instruction.startsWith("测试硬冲突提示")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ task: { id: "task_mock", status: "completed", result: {
          text: "这是一段仍然违反时间线的测试预览。",
          canAccept: false,
          generation: {
            id: "generation_blocked_e2e",
            status: "blocked",
            provider: "test",
            model: "mock-model",
            rewriteCount: 2,
            context: { canonFactIds: ["fact_timeline"], chapterMemoryChapterIds: ["chapter_previous"] },
            attempts: [{ index: 0, status: "completed" }, { index: 1, status: "completed" }, { index: 2, status: "completed" }],
            selectedAttemptIndex: 2,
            conflicts: [
              { severity: "hard", status: "open", message: "人物在事件发生前知道了结果。", evidence: [{ excerpt: "提前说出了结局" }] },
              { severity: "soft", status: "open", message: "人物语气与此前略有差异。", evidence: [] }
            ]
          }
        } } })
      });
      return;
    }
    await route.continue();
  });
  await id(page, "generate-editor-ai-button").click();
  await expect(id(page, "editor-ai-run-meta")).toBeVisible();
  await expect(id(page, "editor-ai-run-meta")).not.toHaveAttribute("data-model", "");
  await expect(id(page, "editor-ai-run-meta")).toHaveAttribute("data-rewrite-count", "0");
  await expect(id(page, "editor-ai-context-details")).toBeVisible();
  await id(page, "editor-ai-context-details").locator("summary").click();
  await expect(id(page, "editor-ai-context-list")).not.toBeEmpty();
  await expect(id(page, "editor-ai-validation-report")).toHaveAttribute("data-state", "passed");
  const draftScreenshot = path.join(evidenceDirectory, "editor-ai-preview.png");
  await page.screenshot({ path: draftScreenshot, fullPage: false });
  console.log(`UI evidence: ${draftScreenshot}`);
  expect(writeRequestBody).toMatchObject({
    workId: expect.any(String),
    chapterId: expect.any(String),
    mode: "continue",
    instruction: expect.stringContaining("让未来求救信立刻带来新的行动压力，不要总结。"),
    selectedText: "",
    baseChapterUpdatedAt: expect.any(String)
  });
  expect(writeRequestBody).not.toHaveProperty("work");
  expect(writeRequestBody).not.toHaveProperty("chapter");
  const firstDraft = await id(page, "ai-edit-result").innerText();
  let acceptRequestBody;
  await page.route("**/generations/**/merge", async (route) => {
    acceptRequestBody = route.request().postDataJSON();
    await route.continue();
  });
  await id(page, "ai-edit-accept").click();
  await expect(id(page, "editor-save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });
  await expect.poll(async () => (await editor.innerText()).replace(/\s/g, "")).toContain(firstDraft.replace(/\s/g, ""));
  expect(acceptRequestBody.baseRevision).toEqual(writeRequestBody.baseRevision);
  expect(acceptRequestBody.hunkIds).toEqual(expect.any(Array));
  expect(acceptRequestBody).not.toHaveProperty("richContent");
  await id(page, "generate-editor-ai-button").click();
  await expect(id(page, "ai-edit-result")).not.toHaveText(firstDraft);
  await id(page, "ai-edit-reject").click();
  await expect(id(page, "ai-edit-result")).toHaveCount(0);

  await id(page, "editor-ai-instruction").fill("测试硬冲突提示");
  await id(page, "generate-editor-ai-button").click();
  await expect(id(page, "editor-ai-run-meta")).toHaveAttribute("data-rewrite-count", "2");
  await expect(id(page, "editor-ai-validation-report")).toHaveAttribute("data-state", "conflicts");
  await expect(id(page, "editor-ai-validation-report")).toContainText("人物在事件发生前知道了结果");
  await expect(id(page, "editor-ai-validation-report")).toContainText("人物语气与此前略有差异");
  await expect(id(page, "ai-edit-accept")).toBeDisabled();
  await expect(id(page, "ai-edit-regenerate")).toBeVisible();
  await id(page, "ai-edit-reject").click();

  let confirmedFacts;
  await page.route("**/canon-proposals/canon_e2e_confirm/confirm", async (route) => {
    confirmedFacts = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposal: { id: "canon_e2e_confirm", status: "accepted" }, canon: { status: "ready", entities: [], facts: [] } }) });
  });
  await page.evaluate(() => window.openCanonProposal({
    id: "canon_e2e_confirm",
    status: "pending",
    changes: [
      { operation: "add", fact: { id: "fact_e2e_1", category: "event_state", predicate: "求救信已经出现", value: "第一章收到未来来信", subjectId: "" } },
      { operation: "add", fact: { id: "fact_e2e_2", category: "timeline", predicate: "倒计时开始", value: "距离城市停摆还有三天", subjectId: "" } }
    ]
  }));
  await expect(id(page, "canon-proposal-dialog")).toBeVisible();
  const canonChecks = id(page, "canon-fact-checkbox");
  await expect(canonChecks).toHaveCount(2);
  await canonChecks.nth(1).uncheck();
  await expect(id(page, "confirm-canon-proposal-button")).toBeEnabled();
  await id(page, "confirm-canon-proposal-button").click();
  await expect(id(page, "canon-proposal-dialog")).toBeHidden();
  expect(confirmedFacts).toEqual({ factIds: ["fact_e2e_1"] });

  await page.route("**/canon-proposals/canon_e2e_reject/reject", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposal: { id: "canon_e2e_reject", status: "rejected" } }) });
  });
  await page.evaluate(() => window.openCanonProposal({
    id: "canon_e2e_reject",
    status: "pending",
    changes: [{ operation: "add", fact: { id: "fact_e2e_3", category: "foreshadowing", predicate: "未解伏笔", value: "来信来源尚未揭晓", subjectId: "" } }]
  }));
  await id(page, "reject-canon-proposal-button").click();
  await expect(id(page, "canon-proposal-dialog")).toBeHidden();
  await expect(id(page, "toast")).toBeVisible();

  await id(page, "nav-ai").click();
  await id(page, "new-chat-button").click();
  await expect(id(page, "chat-empty").first()).toBeVisible();
  await id(page, "chat-history-button").click();
  await expect(id(page, "chat-list").getByTestId("chat-row")).toHaveCount(2);
});

test("tablet width keeps icon navigation and a usable manuscript canvas", async ({ page, request }) => {
  await page.setViewportSize({ width: 900, height: 1024 });
  const created = await request.post("/api/works", { data: { title: "平板测试作品" } });
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await expect(id(page, "brand-word")).toBeVisible();
  await id(page, "nav-editor").click();
  await expect(id(page, "writing-paper")).toBeVisible();
  await expect(id(page, "rich-editor").locator(".ql-editor")).toBeEditable();
});

test("import preview, named history restore and scenes persist after reload", async ({ page }) => {
  await page.goto("/");
  await id(page, "project-switcher").click();
  await id(page, "beta-import").click();
  await id(page, "import-file").setInputFiles({ name: "导入验收.txt", mimeType: "text/plain", buffer: Buffer.from("第一章 灯塔\n林舟检查了灯塔的铜钟。\n第二章 渡口\n渡船在清晨靠岸。", "utf8") });
  await id(page, "parse-import").click();
  await expect(id(page, "import-chapter")).toHaveCount(2);
  await id(page, "beta-form").locator('[name="title"]').fill("闭环验收作品");
  await id(page, "beta-form-submit").click();
  await expect(id(page, "current-work-title")).toHaveText("闭环验收作品");
  await id(page, "nav-editor").click();
  const editor = id(page, "rich-editor").locator(".ql-editor");
  await expect(editor).toContainText("林舟检查了灯塔的铜钟");
  await id(page, "beta-history").click();
  page.once("dialog", (dialog) => dialog.accept("验收命名版本"));
  await id(page, "make-snapshot").click();
  await expect(id(page, "beta-body")).toContainText("验收命名版本");
  await id(page, "beta-dialog").getByTestId("dialog-close").click();
  await editor.fill("正文已修改，准备恢复。");
  await id(page, "beta-history").click();
  await id(page, "revision-row").filter({ hasText: "验收命名版本" }).getByTestId("revision-compare").click();
  await id(page, "restore-revision").click();
  await expect(editor).toContainText("林舟检查了灯塔的铜钟");
  await id(page, "beta-dialog").getByTestId("dialog-close").click();
  await id(page, "beta-scenes").click();
  await id(page, "add-scene").click();
  await id(page, "beta-form").locator('[name="title"]').fill("渡口相遇");
  await id(page, "beta-form").locator('[name="goal"]').fill("核对钟声与船期");
  await id(page, "beta-form-submit").click();
  await expect(id(page, "scene-list")).toContainText("渡口相遇");
  await page.reload();
  await id(page, "nav-editor").click();
  await id(page, "beta-scenes").click();
  await expect(id(page, "scene-list")).toContainText("核对钟声与船期");
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 900, height: 1024 }, { width: 390, height: 844 }]) {
  test(`writing panels and focus mode at ${viewport.width}px`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await request.post("/api/works", { data: { title: "纸白工作台验收" } });
    await page.goto("/");
    await id(page, "nav-editor").click();
    const editor = id(page, "rich-editor").locator(".ql-editor");
    await editor.fill("林舟沿着河岸走向旧灯塔。");
    await id(page, "focus-writing-button").click();
    await expect(id(page, "primary-rail")).toBeHidden();
    await expect(editor).toContainText("旧灯塔");
    await page.keyboard.press("Escape");
    await expect(id(page, "primary-rail")).toBeVisible();
    await id(page, "toggle-editor-ai-button").click();
    await expect(id(page, "editor-ai-panel")).toBeVisible();
    await expect(id(page, "cancel-writing-task")).toBeHidden();
    await id(page, "target-words-preset").selectOption("custom");
    await id(page, "target-words").fill("650");
    if (viewport.width < 1440) await expect(id(page, "chapter-sidebar")).toBeHidden();
    await id(page, "editor-ai-close").click();
    if (viewport.width < 1100) {
      await id(page, "toggle-chapters-button").click();
      await expect(id(page, "chapter-sidebar")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(id(page, "chapter-sidebar")).toBeHidden();
    } else {
      await id(page, "toggle-chapters-button").click();
      await expect(id(page, "chapter-sidebar")).toBeHidden();
      await page.reload();
      await id(page, "nav-editor").click();
      await expect(id(page, "chapter-sidebar")).toBeHidden();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect(editor).toContainText("旧灯塔");
    const screenshot = path.join(evidenceDirectory, `workspace-${viewport.width}.png`);
    await page.screenshot({ path: screenshot });
    console.log(`Layout evidence: ${screenshot}`);
  });
}
