const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const evidenceDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "motai-ui-qa-"));
const pageErrors = new WeakMap();

// Browser plugin not available: exercise the repository's Playwright workflow.
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
  await expect(page).toHaveTitle(/墨台/);
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.locator("vite-error-overlay, nextjs-portal")).toHaveCount(0);
  expect(pageErrors.get(page), "No browser console warnings/errors or uncaught exceptions").toEqual([]);
});

test("新工作台完成 AI 对话、资料草案和富文本写作主流程", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/墨台/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper-blue');
  await expect(page.locator('.primary-rail')).toHaveCSS('background-color', 'rgb(248, 249, 251)');
  await expect(page.locator('#newChatButton')).toHaveCSS('background-color', 'rgb(71, 101, 130)');
  await expect(page.locator("#aiAvailabilityButton")).toContainText("AI 可用");
  await expect(page.getByRole("heading", { name: "AI 创作" })).toBeVisible();
  await expect(page.locator("#sendChatButton")).toBeDisabled();
  await page.locator("#settingsButton").click();
  await expect(page.getByRole("heading", { name: "选择 AI 模型" })).toBeVisible();
  await expect(page.getByLabel("AI 模型")).toBeVisible();
  await expect(page.locator("#settingsDialog input")).toHaveCount(0);
  await expect(page.locator("#aiProviderStatusList")).toBeVisible();
  await expect(page.locator("[data-ai-provider-status]")).toHaveCount(2);
  await expect(page.locator("#settingsDialog details")).toHaveCount(0);
  await expect(page.getByLabel("AI 模型").locator("option")).toHaveCount(2);
  await page.getByLabel("AI 模型").selectOption("openai::gpt-5.5");
  await expect(page.locator("#settingsStatus")).toContainText("OpenAI · gpt-5.5");
  await page.locator('[data-close-dialog="settingsDialog"]').click();
  await page.locator('.rail-item[data-view="editor"]').click();
  await expect(page.locator("#addChapterButton")).toBeDisabled();
  await expect(page.locator("#chapterTitleInput")).toBeDisabled();
  await expect(page.locator("#toggleEditorAiButton")).toBeDisabled();
  await page.locator('.rail-item[data-view="ai"]').click();

  await page.locator(".project-switcher").click();
  await page.locator("#newWorkMenuButton").click();
  await page.locator("#newWorkTitle").fill("新工作台测试小说");
  await page.locator("#newWorkPremise").fill("一名守灯人在雾港收到未来寄来的求救信。 ");
  await page.locator("#newWorkForm").getByRole("button", { name: "创建并开始" }).click();
  await expect(page.locator("#currentWorkTitle")).toHaveText("新工作台测试小说");

  await page.locator("#chatInput").fill("帮我梳理这个故事的核心冲突");
  await page.locator("#chatComposer").getByRole("button", { name: "发送消息" }).click();
  await expect(page.locator(".message.assistant .message-body").last()).toContainText(/主线|目标|故事/);

  await page.locator('[data-generate-artifact="outline"]').first().click();
  await expect(page.locator("#proposalDialog")).toBeVisible();
  const proposalChecks = page.locator('input[name="proposal-section"]');
  await expect(proposalChecks.first()).toBeChecked();
  for (let index = 0; index < await proposalChecks.count(); index += 1) {
    await proposalChecks.nth(index).uncheck();
  }
  await expect(page.locator("#proposalForm").getByRole("button", { name: "请先选择内容" })).toBeDisabled();
  await proposalChecks.first().check();
  await expect(page.locator("#proposalForm").getByRole("button", { name: "确认写入 (1)" })).toBeEnabled();
  await page.locator("#proposalForm").getByRole("button", { name: "确认写入" }).click();
  await expect(page.locator("#toast")).toContainText("草案已写入");

  await page.locator('[data-open-proposal]').first().click();
  await expect(page.locator("#proposalForm").getByRole("button", { name: "已写入" })).toBeEnabled();
  await expect(proposalChecks.first()).toBeChecked();
  await expect(proposalChecks.first()).toHaveAttribute("data-readonly", "true");
  await page.locator(".proposal-section.readonly").first().click();
  await expect(page.locator("#toast")).toContainText("这部分已经写入");
  await expect(proposalChecks.first()).toBeChecked();
  await page.locator("#proposalForm").getByRole("button", { name: "已写入" }).click();
  await expect(page.locator("#toast")).toContainText("已经写入");
  await page.locator('[data-close-dialog="proposalDialog"]').first().click();

  await page.locator('.rail-item[data-view="library"]').click();
  await expect(page.locator("#libraryTitle")).toHaveText("故事大纲");
  await page.locator("#editLibraryButton").click();
  await expect(page.locator('[data-library-field="logline"]')).not.toHaveValue("");

  await page.locator('.rail-item[data-view="editor"]').click();
  await page.locator("#richEditor .ql-editor").click();
  await page.keyboard.type("雾从海面一直漫到守灯塔的窗下。", { delay: 12 });
  await expect(page.locator("#editorSaveState")).toHaveText("已保存", { timeout: 5000 });

  await page.locator("#toggleEditorAiButton").click();
  await expect(page.locator("#editorAiInstruction")).toBeVisible();
  await page.locator("#editorAiMode").selectOption("continue");
  await page.locator("#editorAiInstruction").fill("让未来求救信立刻带来新的行动压力，不要总结。 ");
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
            model: "测试模型",
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
  await page.locator("#generateEditorAiButton").click();
  await expect(page.locator("#editorAiRunMeta")).toBeVisible();
  await expect(page.locator("#editorAiRunMeta")).toContainText("测试模型");
  await expect(page.locator("#editorAiRunMeta")).toContainText("自动重写：0 次");
  await expect(page.locator("#editorAiContextDetails")).toBeVisible();
  await page.locator("#editorAiContextDetails summary").click();
  await expect(page.locator("#editorAiContextList")).toContainText("正式设定");
  await expect(page.locator("#editorAiValidationReport")).toContainText("一致性检查通过");
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
  const firstDraft = await page.locator(".ai-edit-result").innerText();
  let acceptRequestBody;
  await page.route("**/generations/**/merge", async (route) => {
    acceptRequestBody = route.request().postDataJSON();
    await route.continue();
  });
  await page.locator("[data-accept-ai-edit]").click();
  await expect(page.locator("#editorSaveState")).toHaveText("已保存", { timeout: 5000 });
  await expect.poll(async () => (await page.locator("#richEditor .ql-editor").innerText()).replace(/\s/g, "")).toContain(firstDraft.replace(/\s/g, ""));
  expect(acceptRequestBody.baseRevision).toEqual(writeRequestBody.baseRevision);
  expect(acceptRequestBody.hunkIds).toEqual(expect.any(Array));
  expect(acceptRequestBody).not.toHaveProperty("richContent");
  await page.locator("#generateEditorAiButton").click();
  await expect(page.locator(".ai-edit-result")).not.toHaveText(firstDraft);
  await page.locator("[data-reject-ai-edit]").click();
  await expect(page.locator("#editorAiBody")).toContainText("预览已清除");

  await page.locator("#editorAiInstruction").fill("测试硬冲突提示");
  await page.locator("#generateEditorAiButton").click();
  await expect(page.locator("#editorAiRunMeta")).toContainText("自动重写：2 次");
  await expect(page.locator("#editorAiValidationReport")).toContainText("人物在事件发生前知道了结果");
  await expect(page.locator("#editorAiValidationReport")).toContainText("人物语气与此前略有差异");
  await expect(page.locator("[data-accept-ai-edit]")).toBeDisabled();
  await expect(page.locator("[data-regenerate-ai-edit]")).toBeVisible();
  await page.locator("[data-reject-ai-edit]").click();

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
  await expect(page.locator("#canonProposalDialog")).toBeVisible();
  const canonChecks = page.locator('input[name="canon-proposal-fact"]');
  await expect(canonChecks).toHaveCount(2);
  await canonChecks.nth(1).uncheck();
  await expect(page.locator("#confirmCanonProposalButton")).toHaveText("确认更新设定 (1)");
  await page.locator("#confirmCanonProposalButton").click();
  await expect(page.locator("#canonProposalDialog")).toBeHidden();
  expect(confirmedFacts).toEqual({ factIds: ["fact_e2e_1"] });

  await page.route("**/canon-proposals/canon_e2e_reject/reject", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposal: { id: "canon_e2e_reject", status: "rejected" } }) });
  });
  await page.evaluate(() => window.openCanonProposal({
    id: "canon_e2e_reject",
    status: "pending",
    changes: [{ operation: "add", fact: { id: "fact_e2e_3", category: "foreshadowing", predicate: "未解伏笔", value: "来信来源尚未揭晓", subjectId: "" } }]
  }));
  await page.locator("#rejectCanonProposalButton").click();
  await expect(page.locator("#canonProposalDialog")).toBeHidden();
  await expect(page.locator("#toast")).toContainText("不更新正式设定");

  await page.locator('.rail-item[data-view="ai"]').click();
  await page.locator("#newChatButton").click();
  await expect(page.locator(".ai-empty")).toContainText("一起把这个故事想清楚");
  await page.locator("#chatHistoryButton").click();
  await expect(page.locator("#chatList .chat-row")).toHaveCount(2);
});

test("平板宽度使用图标导航并保持正文画布可用", async ({ page, request }) => {
  await page.setViewportSize({ width: 900, height: 1024 });
  const created = await request.post("/api/works", { data: { title: "平板测试作品" } });
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.locator(".brand-word")).toBeVisible();
  await page.locator('.rail-item[data-view="editor"]').click();
  await expect(page.locator(".writing-paper")).toBeVisible();
  await expect(page.locator("#richEditor .ql-editor")).toBeEditable();
});

test("导入预览、命名历史恢复和场景保存后刷新保持一致", async ({ page }) => {
  await page.goto('/');
  await page.locator('.project-switcher').click();
  await page.locator('[data-beta="import"]').click();
  await page.locator('#importFile').setInputFiles({name:'导入验收.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 灯塔\n林舟检查了灯塔的铜钟。\n第二章 渡口\n渡船在清晨靠岸。','utf8')});
  await page.locator('#parseImport').click();
  await expect(page.locator('[data-import-index]')).toHaveCount(2);
  await page.locator('#betaForm [name="title"]').fill('闭环验收作品');
  await page.locator('#betaForm button[type="submit"]').click();
  await expect(page.locator('#currentWorkTitle')).toHaveText('闭环验收作品');
  await page.locator('.rail-item[data-view="editor"]').click();
  await expect(page.locator('#richEditor .ql-editor')).toContainText('林舟检查了灯塔的铜钟');
  await page.locator('[data-beta="history"]').click();
  page.once('dialog',dialog=>dialog.accept('验收命名版本'));
  await page.locator('#makeSnapshot').click();
  await expect(page.locator('#betaBody')).toContainText('验收命名版本');
  await page.locator('[data-close-dialog="betaDialog"]').click();
  await page.locator('#richEditor .ql-editor').fill('正文已修改，准备恢复。');
  await page.locator('[data-beta="history"]').click();
  await page.locator('.beta-row').filter({hasText:'验收命名版本'}).getByRole('button',{name:'比较与恢复'}).click();
  await page.locator('#restoreRevision').click();
  await expect(page.locator('#richEditor .ql-editor')).toContainText('林舟检查了灯塔的铜钟');
  await page.locator('[data-close-dialog="betaDialog"]').click();
  await page.locator('[data-beta="scenes"]').click();
  await page.locator('#addScene').click();
  await page.locator('#betaForm [name="title"]').fill('渡口相遇');
  await page.locator('#betaForm [name="goal"]').fill('核对钟声与船期');
  await page.locator('#betaForm button[type="submit"]').click();
  await expect(page.locator('#sceneList')).toContainText('渡口相遇');
  await page.reload();
  await page.locator('.rail-item[data-view="editor"]').click();
  await page.locator('[data-beta="scenes"]').click();
  await expect(page.locator('#sceneList')).toContainText('核对钟声与船期');
});

for (const viewport of [{width:1440,height:900},{width:1280,height:800},{width:900,height:1024},{width:390,height:844}]) {
 test(`纸白工作台面板与专注模式 ${viewport.width}`,async({page,request})=>{
  await page.setViewportSize(viewport);
  await request.post('/api/works',{data:{title:'纸白工作台验收'}});
  await page.goto('/');
  await page.locator('.rail-item[data-view="editor"]').click();
  const editor=page.locator('#richEditor .ql-editor');
  await editor.fill('林舟沿着河岸走向旧灯塔。');
  await page.locator('#focusWritingButton').click();
  await expect(page.locator('.primary-rail')).toBeHidden();
  await expect(editor).toContainText('旧灯塔');
  await page.keyboard.press('Escape');
  await expect(page.locator('.primary-rail')).toBeVisible();
  await page.locator('#toggleEditorAiButton').click();
  await expect(page.locator('#editorAiPanel')).toBeVisible();
  await expect(page.locator('#cancelWritingTask')).toBeHidden();
  await page.locator('#targetWordsPreset').selectOption('custom');
  await page.locator('#targetWords').fill('650');
  if(viewport.width<1440) await expect(page.locator('#chapterSidebar')).toBeHidden();
  await page.locator('[data-close-editor-ai]').click();
  if(viewport.width<1100) {
   await page.locator('#toggleChaptersButton').click();
   await expect(page.locator('#chapterSidebar')).toBeVisible();
   await page.keyboard.press('Escape');
   await expect(page.locator('#chapterSidebar')).toBeHidden();
  } else {
   await page.locator('#toggleChaptersButton').click();
   await expect(page.locator('#chapterSidebar')).toBeHidden();
   await page.reload();
   await page.locator('.rail-item[data-view="editor"]').click();
   await expect(page.locator('#chapterSidebar')).toBeHidden();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await expect(editor).toContainText('旧灯塔');
  const screenshot=path.join(evidenceDirectory,`paper-blue-${viewport.width}.png`);
  await page.screenshot({path:screenshot}); console.log(`Theme evidence: ${screenshot}`);
 });
}
