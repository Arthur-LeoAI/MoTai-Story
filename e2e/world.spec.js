// World page of the new frontend. Selectors are data-testid and state
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

async function story(request) {
  const created = await request.post("/api/works", { data: { focus: "shape", language: "en", title: "World test" } });
  return (await created.json()).work;
}

test("the world in a sentence is saved on leaving a blank, and kept", async ({ page, request }) => {
  const work = await story(request);
  await page.goto(`/app/works/${work.id}/world`);
  await page.getByTestId("world-what").fill("where the sea has swallowed the old roads");
  await page.getByTestId("world-here").click();
  await expect(page.getByTestId("world-status")).toHaveAttribute("data-status", "saved");
  await page.getByTestId("world-here").fill("a good map is worth more than gold");
  await page.getByTestId("world-what").click();
  await expect.poll(async () => (await (await request.get(`/api/works/${work.id}/world`)).json()).world.here).toBe("a good map is worth more than gold");
  await page.reload();
  await expect(page.getByTestId("world-what")).toHaveValue("where the sea has swallowed the old roads");
  await expect(page.getByTestId("world-here")).toHaveValue("a good map is worth more than gold");
});

test("a rule has three questions, becomes a hard world rule, and can be changed and deleted", async ({ page, request }) => {
  const work = await story(request);
  await page.goto(`/app/works/${work.id}/world`);
  await expect(page.getByTestId("rules-empty")).toBeVisible();

  await page.getByTestId("rule-new").click();
  await page.getByTestId("rule-save").click();
  await expect(page.getByTestId("rule-error")).toBeVisible();
  await page.getByTestId("rule-rule").fill("Speaking someone's true name gives power over them");
  await page.getByTestId("rule-cost").fill("The speaker forgets a memory of their own");
  await page.getByTestId("rule-save").click();
  await expect(page.getByTestId("rule-dialog")).toBeHidden();
  const card = page.getByTestId("rule-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("The speaker forgets a memory of their own");

  // The rule reaches the writing as a hard world rule.
  const canon = (await (await request.get(`/api/works/${work.id}/canon`)).json()).canon;
  const rule = canon.entities.find((entity) => entity.type === "rule");
  expect([rule.name, rule.card.cost, rule.card.exception ?? ""]).toEqual(["Speaking someone's true name gives power over them", "The speaker forgets a memory of their own", ""]);

  await card.click();
  await page.getByTestId("rule-exception").fill("It has no hold on someone who was never named");
  await page.getByTestId("rule-save").click();
  await expect(card).toContainText("It has no hold on someone who was never named");

  await card.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("rule-delete").click();
  await expect(page.getByTestId("rules-empty")).toBeVisible();
});

test("the world page has no sideways scroll on a phone", async ({ page, request }) => {
  const work = await story(request);
  expect((await request.post(`/api/works/${work.id}/canon/entities`, { data: { type: "rule", name: "The tide never turns at night", card: { cost: "Ships wait in harbour until dawn, whatever the cargo" } } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/app/works/${work.id}/world`);
  await expect(page.getByTestId("rule-card")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
