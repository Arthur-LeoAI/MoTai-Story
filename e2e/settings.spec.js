// Settings, import, story settings and search in the new frontend.
// Selectors are data-testid and state attributes only.
const { test, expect } = require("@playwright/test");

const pageErrors = new WeakMap();

test.beforeEach(async ({ page, request }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
  });
  expect((await request.patch("/api/me/preferences", { data: { uiLocale: "en", theme: "paper" } })).ok()).toBeTruthy();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "No console errors, warnings or missing translation keys").toEqual([]);
});

const storedWork = async (request, workId) => (await (await request.get(`/api/works/${workId}`)).json()).work;

test("settings choose the writing model, test the connection and show usage", async ({ page, request }) => {
  await page.goto("/app/");
  await page.getByTestId("settings-link").first().click();
  await expect(page.getByTestId("settings")).toBeVisible();
  await expect(page.getByTestId("settings-test-ai")).toBeVisible();
  const model = page.getByTestId("settings-model");
  // The models the server offers (the current one is also listed if it is not among them).
  await expect(model.locator('option[value="openai::gpt-5.5"]')).toHaveCount(1);
  await expect(model.locator('option[value="deepseek::deepseek-chat"]')).toHaveCount(1);
  // No field on this page ever takes a secret.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  await model.selectOption("openai::gpt-5.5");
  await expect(page.getByTestId("settings-ai-status")).toHaveAttribute("data-state", "ok");
  expect((await (await request.get("/api/ai/config")).json()).config.model).toBe("gpt-5.5");
  await model.selectOption("deepseek::deepseek-chat");
  await expect(page.getByTestId("settings-ai-status")).toHaveAttribute("data-state", "ok");

  await page.getByTestId("settings-test").click();
  await expect(page.getByTestId("settings-ai-status")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("settings-usage-total")).toBeVisible();
  await expect(page.getByTestId("settings-backup-download")).toHaveAttribute("href", "/api/backup");
});

test("a backup file restores the library after confirmation", async ({ page, request }) => {
  const created = await request.post("/api/works", { data: { title: "Kept by the backup", language: "en" } });
  const workId = (await created.json()).work.id;
  const backup = await (await request.get("/api/backup")).body();

  await page.goto("/app/settings");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("settings-backup-file").setInputFiles({ name: "library.json", mimeType: "application/json", buffer: backup });
  await expect(page.getByTestId("settings-backup-message")).toHaveAttribute("data-kind", "ok");
  expect((await storedWork(request, workId)).title).toBe("Kept by the backup");

  // A file that is not a backup is refused without touching the library.
  await page.getByTestId("settings-backup-file").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  await expect(page.getByTestId("settings-backup-message")).toHaveAttribute("data-kind", "error");
});

test("a manuscript is previewed, imported as an English story and opens in Write", async ({ page, request }) => {
  await page.goto("/app/");
  await page.getByTestId("import-open").click();
  await expect(page.getByTestId("import-dialog")).toBeVisible();
  await expect(page.getByTestId("import-language")).toHaveValue("en");
  const text = "Prologue\nThe map arrived unsigned.\nChapter 1\nMira waited at the ferry.\nChapter Two: The Crossing\nKael let her go.";
  await page.getByTestId("import-file").setInputFiles({ name: "ferry.txt", mimeType: "text/plain", buffer: Buffer.from(text, "utf8") });
  await expect(page.getByTestId("import-chapter")).toHaveCount(3);
  await expect(page.getByTestId("import-chapter").nth(2)).toContainText("Chapter Two: The Crossing");
  await page.getByTestId("import-name").fill("The Ferry");
  await page.getByTestId("import-confirm").click();

  await expect(page).toHaveURL(/\/app\/works\/[^/]+\/write/);
  await expect(page.getByTestId("chapter-item")).toHaveCount(3);
  await expect(page.getByTestId("manuscript-editor")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("manuscript-editor")).toContainText("The map arrived unsigned.");
  const workId = new URL(page.url()).pathname.split("/")[3];
  const stored = await storedWork(request, workId);
  expect(stored).toMatchObject({ title: "The Ferry", language: "en", focus: "write", ownerId: "local" });
  expect(stored.chapters.map((chapter) => chapter.title)).toEqual(["Prologue", "Chapter 1", "Chapter Two: The Crossing"]);
});

test("story settings change title, focus and language, and can delete the story", async ({ page, request }) => {
  const created = await request.post("/api/works", { data: { title: "Draft title", language: "en", focus: "write" } });
  const workId = (await created.json()).work.id;
  await page.goto(`/app/works/${workId}/write`);
  const frame = page.getByTestId("work-frame");
  await expect(frame.locator('[data-testid^="nav-"]').first()).toHaveAttribute("data-testid", "nav-write");

  await page.getByTestId("story-chip").click();
  await expect(page.getByTestId("story-settings")).toBeVisible();
  await expect(page.getByTestId("story-export-docx")).toHaveAttribute("href", `/api/works/${workId}/export?format=docx`);
  await page.getByTestId("story-name").fill("The Cartographer's Sister");
  await page.getByTestId("story-focus-shape").check();
  await page.getByTestId("story-language").selectOption("zh-CN");
  await page.getByTestId("story-save").click();
  await expect(page.getByTestId("story-settings")).toBeHidden();
  await expect(page.getByTestId("story-title")).toHaveText("The Cartographer's Sister");
  await expect(page.getByTestId("story-title")).toHaveAttribute("lang", "zh-CN");
  await expect(frame).toHaveAttribute("data-focus", "shape");
  await expect(frame.locator('[data-testid^="nav-"]').first()).toHaveAttribute("data-testid", "nav-ideate");
  expect(await storedWork(request, workId)).toMatchObject({ title: "The Cartographer's Sister", focus: "shape", language: "zh-CN" });

  await page.getByTestId("story-chip").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("story-delete").click();
  await expect(page.getByTestId("hero")).toBeVisible();
  await expect(page.locator(`[data-work-id="${workId}"]`)).toHaveCount(0);
  expect((await request.get(`/api/works/${workId}`)).status()).toBe(404);
});

test("search finds a chapter and opens it", async ({ page, request }) => {
  const created = await request.post("/api/works", { data: { title: "Searchable", language: "en", focus: "write" } });
  const workId = (await created.json()).work.id;
  const first = (await storedWork(request, workId)).chapters[0];
  await request.patch(`/api/works/${workId}/chapters/${first.id}`, { data: { baseRevision: first.revision, content: "Nothing to see here." } });
  const second = (await (await request.post(`/api/works/${workId}/chapters`, { data: {} })).json()).chapter;
  const fresh = (await storedWork(request, workId)).chapters.find((chapter) => chapter.id === second.id);
  await request.patch(`/api/works/${workId}/chapters/${second.id}`, { data: { baseRevision: fresh.revision, content: "The lighthouse keeper read the letter twice." } });

  await page.goto(`/app/works/${workId}/write`);
  await expect(page.getByTestId("manuscript")).toHaveAttribute("data-chapter-id", first.id);
  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("search-input")).toBeFocused();
  await page.keyboard.type("lighthouse");
  await expect(page.getByTestId("search-hit")).toHaveCount(1);
  await page.getByTestId("search-hit").click();
  await expect(page.getByTestId("manuscript")).toHaveAttribute("data-chapter-id", second.id);
  await expect(page.getByTestId("manuscript-editor")).toContainText("lighthouse keeper");

  await page.getByTestId("search-input").fill("nowhere-to-be-found");
  await expect(page.getByTestId("search-empty")).toBeVisible();
});
