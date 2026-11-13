// Write page of the new frontend. Selectors are data-testid and state
// attributes only; text the test itself supplies may be asserted.
const { test, expect } = require("@playwright/test");

const pageErrors = new WeakMap();
const expectedFailures = new WeakMap();

test.beforeEach(async ({ page, request }) => {
  const errors = [];
  pageErrors.set(page, errors);
  expectedFailures.set(page, []);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const text = message.text();
    if (expectedFailures.get(page).some((status) => text.includes(`status of ${status}`))) return;
    errors.push(`${message.type()}: ${text}`);
  });
  expect((await request.patch("/api/me/preferences", { data: { uiLocale: "en", theme: "paper" } })).ok()).toBeTruthy();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "No console errors, warnings or missing translation keys").toEqual([]);
});

async function newStory(request, data = {}) {
  const created = await request.post("/api/works", { data: { focus: "write", language: "en", title: "Ferry", ...data } });
  expect(created.ok()).toBeTruthy();
  return (await created.json()).work.id;
}

const storedWork = async (request, workId) => (await (await request.get(`/api/works/${workId}`)).json()).work;
const editor = (page) => page.getByTestId("manuscript-editor");

test("typing is saved automatically and counted in the story's unit", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/write`);
  await expect(page.getByTestId("write")).toBeVisible();
  await expect(editor(page)).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("chapter-item")).toHaveCount(1);
  await expect(page.getByTestId("chapter-title")).toHaveValue("Chapter 1");

  await editor(page).click();
  await page.keyboard.type("The ferry had no bell.");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });
  await expect(page.getByTestId("chapter-length")).toHaveAttribute("data-count", "5");
  await expect.poll(async () => (await storedWork(request, workId)).chapters[0].content).toContain("The ferry had no bell.");

  await page.getByTestId("chapter-title").fill("The Ferry");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });
  await expect.poll(async () => (await storedWork(request, workId)).chapters[0].title).toBe("The Ferry");

  await page.reload();
  await expect(editor(page)).toContainText("The ferry had no bell.");
  await expect(page.getByTestId("chapter-title")).toHaveValue("The Ferry");

  // A Chinese story counts characters.
  const chineseId = await newStory(request, { language: "zh-CN", title: "渡口" });
  await page.goto(`/app/works/${chineseId}/write`);
  await expect(editor(page)).toHaveAttribute("lang", "zh-CN");
  await editor(page).click();
  await page.keyboard.type("渡船在清晨靠岸");
  await expect(page.getByTestId("chapter-length")).toHaveAttribute("data-count", "7");
});

test("chapters are added, switched, reordered, trashed and restored", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/write`);
  await editor(page).click();
  await page.keyboard.type("First chapter text.");

  // Adding a chapter saves the current one first.
  await page.getByTestId("chapter-add").click();
  await expect(page.getByTestId("chapter-item")).toHaveCount(2);
  await expect(page.getByTestId("chapter-item").nth(1)).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("chapter-title")).toHaveValue("Chapter 2");
  await expect(editor(page)).not.toContainText("First chapter text.");
  expect((await storedWork(request, workId)).chapters[0].content).toContain("First chapter text.");

  await editor(page).click();
  await page.keyboard.type("Second chapter text.");
  await page.getByTestId("chapter-item").first().getByTestId("chapter-open").click();
  await expect(editor(page)).toContainText("First chapter text.");
  await expect(page).toHaveURL(/chapter=/);

  // Reorder: chapter 2 moves to the top.
  const secondId = await page.getByTestId("chapter-item").nth(1).getAttribute("data-chapter-id");
  await page.getByTestId("chapter-item").nth(1).getByTestId("chapter-open").click();
  await page.getByTestId("chapter-item").nth(1).getByTestId("chapter-up").click();
  await expect(page.getByTestId("chapter-item").first()).toHaveAttribute("data-chapter-id", secondId);
  expect((await storedWork(request, workId)).chapters.map((chapter) => chapter.id)[0]).toBe(secondId);
  await expect(editor(page)).toContainText("Second chapter text.");

  // Trash and restore.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("chapter-item").first().getByTestId("chapter-delete").click();
  await expect(page.getByTestId("chapter-item")).toHaveCount(1);
  await page.getByTestId("trash-toggle").click();
  await expect(page.getByTestId("trash-item")).toHaveCount(1);
  await page.getByTestId("trash-restore").click();
  await expect(page.getByTestId("chapter-item")).toHaveCount(2);
  await expect(page.getByTestId("trash-item")).toHaveCount(0);
  await expect(editor(page)).toContainText("Second chapter text.");
});

test("an edit made in another window is not overwritten silently", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/write`);
  await editor(page).click();
  await page.keyboard.type("Version from this window.");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });

  // Another window saves the same chapter.
  const chapter = (await storedWork(request, workId)).chapters[0];
  const other = await request.patch(`/api/works/${workId}/chapters/${chapter.id}`, { data: { baseRevision: chapter.revision, content: "Version from the other window." } });
  expect(other.ok()).toBeTruthy();

  expectedFailures.get(page).push(409);
  await editor(page).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" More.");
  const problem = page.getByTestId("save-problem");
  await expect(problem).toHaveAttribute("data-kind", "conflict", { timeout: 5000 });
  await expect(editor(page)).toContainText("Version from this window. More.");
  expect((await storedWork(request, workId)).chapters[0].content).toContain("Version from the other window.");

  await page.getByTestId("conflict-keep-mine").click();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });
  await expect(problem).toHaveCount(0);
  expect((await storedWork(request, workId)).chapters[0].content).toContain("Version from this window. More.");

  // The other way: load the saved version.
  const latest = (await storedWork(request, workId)).chapters[0];
  await request.patch(`/api/works/${workId}/chapters/${latest.id}`, { data: { baseRevision: latest.revision, content: "Saved elsewhere again." } });
  await editor(page).click();
  await page.keyboard.type("!");
  await expect(problem).toHaveAttribute("data-kind", "conflict", { timeout: 5000 });
  await page.getByTestId("conflict-use-saved").click();
  await expect(editor(page)).toContainText("Saved elsewhere again.");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");
});

test("focus mode shows only the page and Escape leaves it", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/write`);
  await expect(page.getByTestId("chapter-list")).toBeVisible();
  await page.getByTestId("focus-toggle").click();
  await expect(page.getByTestId("focus-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("chapter-list")).toBeHidden();
  await expect(page.getByTestId("nav-write")).toBeHidden();
  await expect(page.getByTestId("manuscript")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("chapter-list")).toBeVisible();
  await expect(page.getByTestId("nav-write")).toBeVisible();
});

test("Write has no sideways scroll on a phone", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workId = await newStory(request, { title: "A long story title that has to wrap on a narrow screen" });
  await page.goto(`/app/works/${workId}/write`);
  await expect(page.getByTestId("manuscript")).toBeVisible();
  await editor(page).click();
  await page.keyboard.type("Words on a phone.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("the assistant continues the chapter and the text is added only on request", async ({ page, request }) => {
  const workId = await newStory(request, { language: "zh-CN", title: "雾港" });
  await page.goto(`/app/works/${workId}/write`);
  await editor(page).click();
  await page.keyboard.type("雾从海面一直漫到守灯塔的窗下。");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });

  await page.getByTestId("assist-mode").selectOption("continue");
  await page.getByTestId("assist-instruction").fill("让求救信带来新的行动压力。");
  let started;
  page.on("request", (req) => { if (req.url().endsWith("/api/tasks") && req.method() === "POST") started = req.postDataJSON(); });
  await page.getByTestId("assist-generate").click();
  const result = page.getByTestId("assist-result");
  await expect(result).toBeVisible({ timeout: 15000 });
  expect(started).toMatchObject({ workId, mode: "continue", instruction: "让求救信带来新的行动压力。", selectedText: "" });
  expect(started.range.length).toBe(0);
  await expect(page.getByTestId("assist-checks")).toHaveAttribute("data-state", "passed");
  const added = (await page.getByTestId("assist-hunk-after").allInnerTexts()).join("");
  expect(added.trim()).not.toBe("");
  // Nothing changes until the writer adds it.
  await expect(editor(page)).not.toContainText(added.trim().slice(0, 8));

  await page.getByTestId("assist-accept").click();
  await expect(page.getByTestId("assist-notice")).toBeVisible();
  await expect(result).toHaveCount(0);
  await expect.poll(async () => (await editor(page).innerText()).replace(/\s/g, "")).toContain(added.replace(/\s/g, "").slice(0, 20));
  await expect.poll(async () => (await storedWork(request, workId)).chapters[0].content.replace(/\s/g, "")).toContain(added.replace(/\s/g, "").slice(0, 20));
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");

  // The merge queued a review; Checks lists whatever it found.
  await page.getByTestId("tab-checks").click();
  await expect(page.getByTestId("checks")).toBeVisible();
  await expect(page.getByTestId("checks-empty").or(page.getByTestId("fact-proposal").first())).toBeVisible({ timeout: 15000 });
});

test("rewriting needs a selection, and a discarded suggestion leaves the text alone", async ({ page, request }) => {
  const workId = await newStory(request, { language: "zh-CN", title: "润色" });
  await page.goto(`/app/works/${workId}/write`);
  await editor(page).click();
  await page.keyboard.type("林舟沿着河岸走向旧灯塔。");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });

  await page.getByTestId("assist-mode").selectOption("polish");
  await page.getByTestId("assist-generate").click();
  await expect(page.getByTestId("assist-error")).toBeVisible();

  await editor(page).click();
  await page.keyboard.press("Control+A");
  await page.getByTestId("assist-generate").click();
  const result = page.getByTestId("assist-result");
  await expect(result).toBeVisible({ timeout: 15000 });
  // The test AI may return the passage unchanged; then there is nothing to add.
  await expect(page.getByTestId("assist-hunk").first().or(page.getByTestId("assist-no-change"))).toBeVisible();
  if (await page.getByTestId("assist-no-change").count()) await expect(page.getByTestId("assist-accept")).toBeDisabled();
  await page.getByTestId("assist-discard").click();
  await expect(result).toHaveCount(0);
  await expect(editor(page)).toHaveText("林舟沿着河岸走向旧灯塔。");
});

test("a suggestion that contradicts the story cannot be added", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/write`);
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ task: { id: "task_mock", status: "completed", result: {
      text: "Kael waited at the ferry.",
      canAccept: false,
      generation: {
        id: "generation_blocked", status: "blocked", provider: "test", model: "mock", rewriteCount: 2,
        hunks: [{ id: "h0", index: 0, length: 0, before: "", after: "Kael waited at the ferry." }],
        context: { canonFactIds: [], chapterMemoryChapterIds: [] },
        conflicts: [
          { id: "c1", severity: "hard", status: "open", kind: "contradiction", message: "Kael is still in the capital.", evidence: [{ excerpt: "Kael stayed at the capital." }] },
          { id: "c2", severity: "soft", status: "open", kind: "suggestion", message: "His voice sounds different here.", evidence: [] }
        ]
      }
    } } }) });
  });
  await page.getByTestId("assist-generate").click();
  const result = page.getByTestId("assist-result");
  await expect(result).toHaveAttribute("data-can-accept", "false");
  await expect(result).toHaveAttribute("data-rewrites", "2");
  await expect(page.getByTestId("assist-checks")).toHaveAttribute("data-state", "conflicts");
  await expect(page.getByTestId("assist-conflict")).toHaveCount(2);
  await expect(page.locator('[data-testid="assist-conflict"][data-severity="hard"]')).toContainText("Kael is still in the capital.");
  await expect(page.getByTestId("assist-accept")).toBeDisabled();
});

test("new facts from a chapter are confirmed one by one", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/write`);
  await page.getByTestId("tab-checks").click();
  await expect(page.getByTestId("checks-empty")).toBeVisible();
  const chapterId = await page.getByTestId("manuscript").getAttribute("data-chapter-id");

  const proposal = { id: "canon_e2e", chapterId, status: "pending", changes: [
    { operation: "add", fact: { id: "fact_1", category: "event_state", predicate: "The letter has arrived", value: "Chapter 1" } },
    { operation: "add", fact: { id: "fact_2", category: "timeline", predicate: "Countdown", value: "Three days left" } }
  ] };
  let confirmed;
  await page.route(`**/api/works/${workId}`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ work: { canonProposals: confirmed ? [] : [proposal] } }) }));
  await page.route(`**/chapters/${chapterId}/review`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposal }) }));
  await page.route("**/canon-proposals/canon_e2e/confirm", async (route) => {
    confirmed = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposal: { ...proposal, status: "accepted" } }) });
  });

  await page.getByTestId("checks-review").click();
  await expect(page.getByTestId("fact-item")).toHaveCount(2);
  await page.getByTestId("fact-checkbox").nth(1).uncheck();
  await page.getByTestId("fact-confirm").click();
  await expect(page.getByTestId("checks-empty")).toBeVisible();
  expect(confirmed).toEqual({ factIds: ["fact_1"] });
});

test("a named version can be compared and restored", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/write`);
  await editor(page).click();
  await page.keyboard.type("Original opening line.");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });

  await page.getByTestId("tab-history").click();
  await page.getByTestId("version-name").fill("Before the rewrite");
  await page.getByTestId("version-save").click();
  await expect(page.getByTestId("history-notice")).toBeVisible();
  const named = page.getByTestId("version-row").filter({ hasText: "Before the rewrite" });
  await expect(named).toHaveCount(1);

  await editor(page).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("A completely different line.");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });

  await page.getByTestId("version-row").filter({ hasText: "Before the rewrite" }).getByTestId("version-compare-open").click();
  await expect(page.getByTestId("version-old")).toContainText("Original opening line.");
  await page.getByTestId("version-restore").click();
  await expect(editor(page)).toContainText("Original opening line.");
  await expect.poll(async () => (await storedWork(request, workId)).chapters[0].content).toContain("Original opening line.");
  // The replaced text is kept too.
  await expect(page.locator('[data-testid="version-row"][data-source="restore"]').first()).toBeVisible();
});

test("scenes are planned, edited, reordered and kept after a reload", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/write`);
  await editor(page).click();
  await page.keyboard.type("Mira waits at the ferry.");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });

  await page.getByTestId("tab-scenes").click();
  const rows = page.getByTestId("scene-row");
  // Every chapter starts with one scene covering its text (set by the server).
  await expect(rows).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await rows.first().getByTestId("scene-delete").click();
  await expect(page.getByTestId("scenes-empty")).toBeVisible();

  await page.getByTestId("scene-add").click();
  await page.getByTestId("scene-title").fill("At the ferry");
  await page.getByTestId("scene-goal").fill("Show whose side Kael is on.");
  await page.getByTestId("scene-save").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByTestId("scene-row-goal")).toHaveText("Show whose side Kael is on.");

  await page.getByTestId("scene-add").click();
  await page.getByTestId("scene-title").fill("Crossing");
  await page.getByTestId("scene-status").selectOption("draft");
  await page.getByTestId("scene-save").click();
  await expect(rows).toHaveCount(2);

  await rows.nth(1).getByTestId("scene-up").click();
  await expect(rows.first()).toContainText("Crossing");
  await expect(rows.first()).toHaveAttribute("data-status", "draft");

  await rows.nth(1).getByTestId("scene-edit").click();
  await page.getByTestId("scene-goal").fill("Kael lets her go.");
  await page.getByTestId("scene-save").click();
  await expect(rows.nth(1).getByTestId("scene-row-goal")).toHaveText("Kael lets her go.");

  await page.reload();
  await page.getByTestId("tab-scenes").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Crossing");
  // Planning never changes the chapter text.
  await expect(editor(page)).toHaveText("Mira waits at the ferry.");
});

test("trashing another chapter keeps the open one, and a stale reorder is refused", async ({ page, request }) => {
  const workId = await newStory(request);
  for (let i = 0; i < 2; i += 1) await request.post(`/api/works/${workId}/chapters`, { data: {} });
  const chapters = (await storedWork(request, workId)).chapters;
  await page.goto(`/app/works/${workId}/write?chapter=${chapters[1].id}`);
  await expect(page.getByTestId("manuscript")).toHaveAttribute("data-chapter-id", chapters[1].id);

  page.once("dialog", (dialog) => dialog.accept());
  // Tools of a chapter that is not open appear on hover or keyboard focus.
  const third = page.locator(`[data-testid="chapter-item"][data-chapter-id="${chapters[2].id}"]`);
  await third.hover();
  await third.getByTestId("chapter-delete").click();
  await expect(page.getByTestId("chapter-item")).toHaveCount(2);
  await expect(page.getByTestId("manuscript")).toHaveAttribute("data-chapter-id", chapters[1].id);

  // Another window reorders the chapters; this page still shows the old order.
  const fresh = await storedWork(request, workId);
  const otherOrder = [chapters[1].id, chapters[0].id];
  expect((await request.patch(`/api/works/${workId}/plan`, { data: { chapterIds: otherOrder, baseRevision: fresh.structureRevision } })).ok()).toBeTruthy();
  expectedFailures.get(page).push(409);
  await page.locator(`[data-testid="chapter-item"][data-chapter-id="${chapters[1].id}"]`).getByTestId("chapter-up").click();
  await expect(page.getByTestId("write-notice")).toBeVisible();
  // The page shows what the other window saved instead of overwriting it.
  await expect(page.getByTestId("chapter-item").first()).toHaveAttribute("data-chapter-id", chapters[1].id);
  expect((await storedWork(request, workId)).chapters.map((chapter) => chapter.id)).toEqual(otherOrder);

  // Renaming a chapter moves the structure revision; reordering afterwards still works.
  await page.getByTestId("chapter-title").fill("Renamed");
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved", { timeout: 5000 });
  const firstItem = page.locator(`[data-testid="chapter-item"][data-chapter-id="${chapters[0].id}"]`);
  await firstItem.hover();
  await firstItem.getByTestId("chapter-up").click();
  await expect(page.getByTestId("chapter-item").first()).toHaveAttribute("data-chapter-id", chapters[0].id);
});
