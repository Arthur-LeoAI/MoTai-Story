const { test, expect } = require("@playwright/test");

test("新工作台完成 AI 对话、资料草案和富文本写作主流程", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/墨台/);
  await expect(page.getByRole("heading", { name: "AI 创作" })).toBeVisible();

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
  for (let index = 1; index < await proposalChecks.count(); index += 1) {
    await proposalChecks.nth(index).uncheck();
  }
  await page.locator("#proposalForm").getByRole("button", { name: "确认写入" }).click();
  await expect(page.locator("#toast")).toContainText("草案已写入");

  await page.locator('.rail-item[data-view="library"]').click();
  await expect(page.locator("#libraryTitle")).toHaveText("故事大纲");
  await page.locator("#editLibraryButton").click();
  await expect(page.locator('[data-library-field="logline"]')).not.toHaveValue("");

  await page.locator('.rail-item[data-view="editor"]').click();
  await page.locator("#richEditor .ql-editor").click();
  await page.keyboard.type("雾从海面一直漫到守灯塔的窗下。", { delay: 12 });
  await expect(page.locator("#editorSaveState")).toHaveText("已保存", { timeout: 5000 });

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
  await expect(page.locator(".brand-word")).toBeHidden();
  await page.locator('.rail-item[data-view="editor"]').click();
  await expect(page.locator(".writing-paper")).toBeVisible();
  await expect(page.locator("#richEditor .ql-editor")).toBeEditable();
});
