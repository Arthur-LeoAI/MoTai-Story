// Writing styles in the new frontend. Selectors are data-testid and state
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

test("the story's writing style is chosen in the assistant and kept for the story", async ({ page, request }) => {
  const created = await request.post("/api/works", { data: { focus: "write", language: "en", title: "Style test" } });
  const { work } = await created.json();
  await page.goto(`/app/works/${work.id}/write`);
  const select = page.getByTestId("style-select");
  await expect(select).toBeVisible();
  // English stories get the English set.
  await expect(select.locator("option")).toHaveCount(7);
  await expect(select).toHaveValue("");
  await select.selectOption("builtin:gothic");
  await expect(page.getByTestId("style-description")).toContainText("Dread, decay and old secrets");
  await expect.poll(async () => (await (await request.get(`/api/works/${work.id}/style`)).json()).styleId).toBe("builtin:gothic");
  await page.reload();
  await expect(page.getByTestId("style-select")).toHaveValue("builtin:gothic");
});

test("your own style is drafted from a few words, saved, chosen for the story, exported and imported", async ({ page, request }) => {
  // Start clean: styles belong to the writer, across tests.
  for (const style of (await (await request.get("/api/me/styles")).json()).styles) {
    await request.delete(`/api/me/styles/${style.id}`, { data: { baseRevision: style.revision } });
  }
  const created = await request.post("/api/works", { data: { focus: "write", language: "en", title: "Own style test" } });
  const { work } = await created.json();
  await page.goto(`/app/works/${work.id}/write`);
  await page.getByTestId("style-manage").click();
  const manager = page.getByTestId("style-manager");
  await expect(manager).toBeVisible();
  await expect(manager.getByTestId("own-styles-empty")).toBeVisible();

  // A few words become a draft card; nothing is saved until "Save".
  await manager.getByTestId("style-source").fill("quiet, close to one person");
  await manager.getByTestId("style-draft").click();
  await expect(manager.getByTestId("style-form")).toBeVisible();
  await expect(manager.getByTestId("style-name")).not.toHaveValue("");
  expect((await (await request.get("/api/me/styles")).json()).styles).toHaveLength(0);
  await manager.getByTestId("style-name").fill("My quiet style");
  await manager.getByTestId("style-save").click();
  await expect(manager.getByTestId("own-style")).toHaveCount(1);

  // Export gives a file that imports back as a style of its own.
  const download = page.waitForEvent("download");
  await manager.getByTestId("own-style-export").click();
  const file = await (await download).path();
  await manager.getByTestId("style-import-file").setInputFiles(file);
  await expect(manager.getByTestId("style-manager-notice")).toContainText("My quiet style");
  await expect(manager.getByTestId("own-style")).toHaveCount(2);
  await manager.getByTestId("style-manager-close").click();

  // It can be the story's style.
  const select = page.getByTestId("style-select");
  await expect(select.locator("optgroup").nth(1).locator("option")).toHaveCount(2);
  const mine = (await (await request.get("/api/me/styles")).json()).styles.find((style) => style.source === "user");
  await select.selectOption(mine.id);
  await expect.poll(async () => (await (await request.get(`/api/works/${work.id}/style`)).json()).styleId).toBe(mine.id);
});

test("three ways rewrite a selected passage side by side; the one picked replaces it, and undo brings it back", async ({ page, request }) => {
  const created = await request.post("/api/works", { data: { focus: "write", language: "en", title: "Three ways test" } });
  const { work } = await created.json();
  const chapter = (await (await request.get(`/api/works/${work.id}`)).json()).work.chapters[0];
  expect((await request.patch(`/api/works/${work.id}/chapters/${chapter.id}`, { data: { baseRevision: chapter.revision, content: "She was angry. She left the room." } })).ok()).toBeTruthy();
  await page.goto(`/app/works/${work.id}/write?chapter=${chapter.id}`);
  const editor = page.getByTestId("manuscript-editor");
  await expect(editor).toContainText("She was angry.");

  // Nothing selected: it says so.
  await page.getByTestId("ways-ask").click();
  await expect(page.getByTestId("ways-error")).toBeVisible();

  // Select "She was angry." and ask, with explanations on.
  await editor.click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < "She was angry.".length; i += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.getByTestId("ways-explain").check();
  await page.getByTestId("ways-ask").click();
  const ways = page.getByTestId("way");
  await expect(ways).toHaveCount(3);
  await expect(ways.nth(0)).toContainText("Tenser");
  await expect(page.getByTestId("way-why")).toHaveCount(3);

  await ways.nth(1).getByTestId("way-use").click();
  await expect(editor).toContainText("She was angry. (Richer) She left the room.");
  await expect(page.getByTestId("ways-notice")).toBeVisible();
  // Saved like typing.
  await expect.poll(async () => (await (await request.get(`/api/works/${work.id}`)).json()).work.chapters[0].content).toContain("(Richer)");

  // Undo brings the original back.
  await editor.focus();
  await page.keyboard.press("Control+z");
  await expect(editor).not.toContainText("(Richer)");
  await expect(editor).toContainText("She was angry. She left the room.");
});
