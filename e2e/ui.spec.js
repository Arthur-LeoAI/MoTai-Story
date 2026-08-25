const { test, expect } = require("@playwright/test");

test("作者可以创建作品、切换主题、生成设定、导出并恢复完整备份", async ({ page, request }) => {
  await page.goto("/legacy.html");
  await page.getByRole("button", { name: "进入" }).click();
  await page.locator("#newWorkButton").click();
  await page.locator("#newWorkTitle").fill("端到端测试小说");
  await page.locator("#newWorkPremise").fill("一名学徒在星港接到未来信号，必须守住失控的航线。");
  await page.locator("#newWorkForm").getByRole("button", { name: "创建" }).click();
  await expect(page.locator("#workTitleInput")).toHaveValue("端到端测试小说");

  await page.locator("#chapterTitleInput").fill("第一章 星港信号");
  await expect(page.locator("#chapterList")).toContainText("第一章 星港信号");
  await page.locator("#addChapterButton").click();
  await expect(page.locator("[data-delete-chapter-id]")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("[data-delete-chapter-id]").last().click();
  await expect(page.locator("[data-delete-chapter-id]")).toHaveCount(1);

  await page.locator('[data-main-view="cover"]').click();
  await page.locator("#coverUploadInput").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3HwAAAABJRU5ErkJggg==", "base64")
  });
  await expect(page.locator("#coverHistoryList [data-cover-history-id]")).toHaveCount(1);
  await expect(page.locator("#quickCoverHistory img")).toHaveCount(1);
  await expect(page.locator("#coverHistoryCount")).toHaveText("1 个版本");
  await page.locator('.main-nav-item[data-main-view="create"]').click();

  await page.locator("#insertIllustrationButton").click();
  await expect(page.locator("#chapterImageModal")).toBeVisible();
  await page.locator("#chapterImageCaptionInput").fill("星港雨幕");
  await page.locator("#chapterImageUploadInput").setInputFiles({
    name: "scene.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3HwAAAABJRU5ErkJggg==", "base64")
  });
  await expect(page.locator("#chapterImageModal")).toBeHidden();
  await expect(page.locator("#chapterContentInput")).toHaveValue(/星港雨幕/);
  await page.locator("#previewModeButton").click();
  await expect(page.locator("#chapterPreview .chapter-illustration img")).toBeVisible();
  await page.locator("#writeModeButton").click();

  const homeArtForTheme = {
    dark: "ink-window.png",
    midnight: "star-observatory.png",
    paper: "amber-study.png",
    light: "dawn-studio.png"
  };
  for (const theme of ["dark", "midnight", "paper", "light"]) {
    await page.locator("#themeToggleButton").click();
    await page.locator(`[data-theme-option="${theme}"]`).click();
    await expect(page.locator("body")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("#homeArtImage")).toHaveAttribute("src", new RegExp(homeArtForTheme[theme]));

    if (theme === "dark") {
      await page.locator("#newWorkButton").click();
      await expect(page.locator("#newWorkModal")).toBeVisible();
      const modalBackground = await page.locator("#newWorkModal").evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(modalBackground).not.toBe("rgb(255, 255, 255)");
      await page.locator("#newWorkModal").getByRole("button", { name: "取消" }).click();
    }
  }

  await page.locator("#wallpaperToggleButton").click();
  await page.locator('[data-wallpaper-id="star-voyage"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-wallpaper-active", "true");
  await expect.poll(() => page.locator("body").evaluate((element) => getComputedStyle(element).getPropertyValue("--wallpaper-image"))).toContain("star-voyage.png");

  await page.locator('[data-toolbar-action="generate-bible"]').click();
  await expect(page.locator("#storyBibleStatus")).toContainText("本地备用");
  await page.locator("#storyQualityCheckButton").click();
  await expect(page.locator("#storyQualitySummary")).toContainText(/分/);

  await page.locator('[data-main-view="characters"]').click();
  await expect(page.locator("#characterCardList .structured-card").first()).toBeVisible();
  const cardCount = await page.locator("#characterCardList .structured-card").count();
  await page.locator("#addCharacterCardButton").click();
  await expect(page.locator("#characterCardList .structured-card")).toHaveCount(cardCount + 1);

  await page.locator('[data-main-view="timeline"]').click();
  await expect(page.locator("#chapterBoard .chapter-board-column")).toHaveCount(3);
  await page.locator("#chapterGoalInput").fill("在星港确认未来信号来源");
  await expect(page.locator("#chapterBoard")).toContainText("确认未来信号来源");

  await page.locator('[data-main-view="cover"]').click();
  await page.locator("#coverLoglineInput").fill("星港信号指向被遗忘的航线。");
  await page.locator("#coverPaletteSelect").selectOption("teal");
  await page.locator("#coverTitleAlignSelect").selectOption("center");
  await page.locator("#coverShowAuthorInput").uncheck();
  await page.locator("#coverShowMetadataInput").uncheck();
  await page.locator("#coverRebuildButton").click();
  await expect(page.locator("#coverHistoryCount")).toHaveText("2 个版本");

  const workId = await page.locator("[data-work-id]").first().getAttribute("data-work-id");
  for (const format of ["markdown", "txt", "html", "doc", "pdf"]) {
    const response = await request.get(`/api/works/${workId}/export?format=${format}`);
    expect(response.ok()).toBeTruthy();
  }

  const backupResponse = await request.get("/api/backup");
  const backup = await backupResponse.text();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#backupRestoreInput").setInputFiles({
    name: "测试.motai-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup)
  });
  await expect(page.locator("#backupNote")).toContainText("恢复完成");
});

test("快速切换作品时，延迟保存和设定生成不会污染另一部作品", async ({ page, request }) => {
  await request.patch("/api/ui-preferences", {
    data: {
      theme: "light",
      exportFormat: "markdown",
      inspectorTab: "write",
      toolbarPrefs: { ai: true, bible: true, work: true, cover: true, settings: true },
      workspace: { workId: "", chapterId: "", mainView: "home", previewMode: false }
    }
  });
  await page.goto("/legacy.html");
  await page.getByRole("button", { name: "进入" }).click();

  async function createWork(title, premise) {
    await page.locator("#newWorkButton").click();
    await page.locator("#newWorkTitle").fill(title);
    await page.locator("#newWorkPremise").fill(premise);
    await page.locator("#newWorkForm").getByRole("button", { name: "创建" }).click();
    await expect(page.locator("#workTitleInput")).toHaveValue(title);
    return page.locator('[data-work-id]').first().getAttribute("data-work-id");
  }

  const firstId = await createWork("延迟保存作品 A", "A 的原创星际冒险梗概。");
  const secondId = await createWork("延迟保存作品 B", "B 的都市奇幻梗概。");

  await page.locator(`[data-work-id="${firstId}"]`).click();
  await expect(page.locator("#workTitleInput")).toHaveValue("延迟保存作品 A");
  await page.locator('[data-main-view="work"]').click();
  await expect(page.locator("#premiseInput")).toBeVisible();
  await page.locator("#premiseInput").fill("A 更新后的星际冒险梗概。");
  await page.locator(`[data-work-id="${secondId}"]`).click();
  await expect(page.locator("#workTitleInput")).toHaveValue("延迟保存作品 B");
  await page.waitForTimeout(900);

  const firstAfterSave = await (await request.get(`/api/works/${firstId}`)).json();
  const secondAfterSave = await (await request.get(`/api/works/${secondId}`)).json();
  expect(firstAfterSave.work.premise).toBe("A 更新后的星际冒险梗概。");
  expect(secondAfterSave.work.premise).toBe("B 的都市奇幻梗概。");

  await page.locator(`[data-work-id="${firstId}"]`).click();
  await expect(page.locator("#workTitleInput")).toHaveValue("延迟保存作品 A");
  await page.route(`**/api/works/${firstId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.continue();
  });
  await page.locator('[data-toolbar-action="generate-bible"]').click();
  await page.locator(`[data-work-id="${secondId}"]`).click();
  await expect(page.locator("#workTitleInput")).toHaveValue("延迟保存作品 B");
  await page.waitForTimeout(1000);

  const firstAfterBible = await (await request.get(`/api/works/${firstId}`)).json();
  const secondAfterBible = await (await request.get(`/api/works/${secondId}`)).json();
  expect(firstAfterBible.work.storyBible.logline).not.toBe("");
  expect(secondAfterBible.work.storyBible.logline).toBe("");

  await request.patch(`/api/works/${secondId}`, {
    data: {
      storyBible: {
        overview: "超神学院系统流",
        worldview: "雄兵连与饕餮战争。",
        characters: "卢小鱼魂穿葛小伦。",
        conflict: "卡尔与虚空来袭。",
        outline: "加入雄兵连。",
        chapterPlan: "第1章｜雄兵连｜剧情目标：加入学院｜成长点：觉醒｜爽点：系统奖励｜冲突：饕餮来袭｜结尾钩子：卡尔现身"
      }
    }
  });

  await page.locator(`[data-work-id="${secondId}"]`).click();
  await expect(page.locator("#workTitleInput")).toHaveValue("延迟保存作品 B");
  await page.locator('[data-main-view="work"]').click();
  let staleBibleWasResubmitted = false;
  await page.route(`**/api/works/${secondId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      staleBibleWasResubmitted = Object.hasOwn(route.request().postDataJSON(), "storyBible");
    }
    await route.continue();
  });
  await page.locator('[data-toolbar-action="generate-bible"]').click();
  await expect(page.locator("#storyBibleStatus")).toContainText("本地备用");

  const secondAfterRegeneration = await (await request.get(`/api/works/${secondId}`)).json();
  const generatedBible = Object.values(secondAfterRegeneration.work.storyBible).join("\n");
  expect(staleBibleWasResubmitted).toBeFalsy();
  expect(generatedBible).not.toMatch(/超神学院|雄兵连|葛小伦|卢小鱼|卡尔|虚空/);
});

test("重启后从首页进入，并恢复最近作品、章节与阅读偏好", async ({ page, request }) => {
  await request.patch("/api/ui-preferences", {
    data: {
      theme: "light",
      exportFormat: "markdown",
      inspectorTab: "write",
      toolbarPrefs: { ai: true, bible: true, work: true, cover: true, settings: true },
      workspace: { workId: "", chapterId: "", mainView: "home", previewMode: false }
    }
  });
  await page.goto("/legacy.html");
  await page.getByRole("button", { name: "进入" }).click();
  await page.locator("#newWorkButton").click();
  await page.locator("#newWorkTitle").fill("恢复现场测试");
  await page.locator("#newWorkForm").getByRole("button", { name: "创建" }).click();
  await expect(page.locator("#workTitleInput")).toHaveValue("恢复现场测试");

  await page.locator("#addChapterButton").click();
  await expect(page.locator(".chapter-card.active")).toContainText("第2章");
  await page.locator("#previewModeButton").click();
  await page.locator('[data-main-view="bible"]').click();
  await page.locator("#themeToggleButton").click();
  await page.locator('[data-theme-option="midnight"]').click();
  await page.locator("#wallpaperToggleButton").click();
  await page.locator('[data-wallpaper-id="star-voyage"]').click();

  await expect.poll(async () => {
    const response = await request.get("/api/ui-preferences");
    const payload = await response.json();
    return `${payload.preferences.theme}|${payload.preferences.workspace.mainView}|${payload.preferences.workspace.previewMode}|${payload.preferences.wallpaper.selectedId}`;
  }).toBe("midnight|bible|true|star-voyage");
  await page.evaluate(() => localStorage.clear());

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "midnight");
  await expect.poll(() => page.locator("body").evaluate((element) => getComputedStyle(element).getPropertyValue("--wallpaper-image"))).toContain("star-voyage.png");
  await expect(page.locator("#homeScreen")).toBeVisible();
  await expect(page.locator(".studio")).toHaveClass(/hidden/);
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page.locator("#workTitleInput")).toHaveValue("恢复现场测试");
  await expect(page.locator(".chapter-card.active")).toContainText("第2章");
  await expect(page.locator('.main-nav-item[data-main-view="create"]')).toHaveClass(/active/);
  await page.locator('[data-main-view="write"]').click();
  await expect(page.locator("#chapterContentInput")).toHaveClass(/hidden/);
});
