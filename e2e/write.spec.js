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
