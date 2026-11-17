// Plot page of the new frontend. Selectors are data-testid and state
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
  const created = await request.post("/api/works", { data: { focus: "shape", language: "en", title: "Plot test" } });
  const { work } = await created.json();
  expect((await request.post(`/api/works/${work.id}/canon/entities`, { data: { type: "character", name: "Mira" } })).ok()).toBeTruthy();
  return work;
}

const line = (page, name, index = 0) => page.locator(`[data-testid="spine-line"][data-line="${name}"][data-index="${index}"]`);
const spineOf = async (request, workId) => (await (await request.get(`/api/works/${workId}/spine`)).json()).spine;

test("the spine is written line by line, saved on leaving a box, and kept", async ({ page, request }) => {
  const work = await story(request);
  await page.goto(`/app/works/${work.id}/plot`);
  await expect(page.getByTestId("spine-line")).toHaveCount(6);

  await line(page, "once").getByTestId("spine-input").fill("Mira draws maps for smugglers");
  await line(page, "everyDay").getByTestId("spine-input").click();
  await expect(page.getByTestId("spine-status")).toHaveAttribute("data-status", "saved");

  // A second "because of that", then the first removed.
  await page.getByTestId("spine-add").click();
  await expect(page.locator('[data-testid="spine-line"][data-line="because"]')).toHaveCount(2);
  await line(page, "because", 0).getByTestId("spine-input").fill("She sails north");
  await line(page, "because", 1).getByTestId("spine-input").fill("The harbour closes behind her");
  await line(page, "finally").getByTestId("spine-input").click();
  await expect.poll(async () => (await spineOf(request, work.id)).because).toEqual(["She sails north", "The harbour closes behind her"]);
  await line(page, "because", 0).getByTestId("spine-remove").click();
  await expect.poll(async () => (await spineOf(request, work.id)).because).toEqual(["The harbour closes behind her"]);

  await page.reload();
  await expect(line(page, "once").getByTestId("spine-input")).toHaveValue("Mira draws maps for smugglers");
  await expect(line(page, "because", 0).getByTestId("spine-input")).toHaveValue("The harbour closes behind her");
});

test("the AI suggests ways to finish a line; only the one picked is kept", async ({ page, request }) => {
  const work = await story(request);
  await page.goto(`/app/works/${work.id}/plot`);
  await line(page, "once").getByTestId("spine-input").fill("Mira draws maps for smugglers");

  // Asking saves what is in the boxes first, so the AI reads it.
  await line(page, "oneDay").getByTestId("spine-suggest").click();
  const suggestions = line(page, "oneDay").getByTestId("spine-suggestion");
  await expect(suggestions).toHaveCount(3);
  expect((await spineOf(request, work.id)).once).toBe("Mira draws maps for smugglers");
  expect((await spineOf(request, work.id)).oneDay).toBe("");

  const picked = await suggestions.nth(1).innerText();
  await suggestions.nth(1).click();
  await expect(line(page, "oneDay").getByTestId("spine-suggestions")).toHaveCount(0);
  await expect(line(page, "oneDay").getByTestId("spine-input")).toHaveValue(picked);
  await expect.poll(async () => (await spineOf(request, work.id)).oneDay).toBe(picked);

  // "None of these" keeps the line as it was.
  await line(page, "finally").getByTestId("spine-suggest").click();
  await expect(line(page, "finally").getByTestId("spine-suggestion")).toHaveCount(3);
  await line(page, "finally").getByTestId("spine-dismiss").click();
  await expect(line(page, "finally").getByTestId("spine-input")).toHaveValue("");
});

test("a spine changed elsewhere is not overwritten", async ({ page, request }) => {
  const work = await story(request);
  expectedFailures.get(page).push(409);
  await page.goto(`/app/works/${work.id}/plot`);
  await expect(page.getByTestId("spine-line")).toHaveCount(6);
  expect((await request.put(`/api/works/${work.id}/spine`, { data: { lines: { once: "Saved elsewhere" }, baseRevision: 0 } })).ok()).toBeTruthy();

  await line(page, "once").getByTestId("spine-input").fill("Typed here");
  await line(page, "everyDay").getByTestId("spine-input").click();
  await expect(page.getByTestId("spine-error")).toBeVisible();
  expect((await spineOf(request, work.id)).once).toBe("Saved elsewhere");
  await page.getByTestId("spine-error").getByRole("button").click();
  await expect(line(page, "once").getByTestId("spine-input")).toHaveValue("Saved elsewhere");
  await expect(page.getByTestId("spine-error")).toHaveCount(0);
});

test("the plot page has no sideways scroll on a phone", async ({ page, request }) => {
  const work = await story(request);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/app/works/${work.id}/plot`);
  await expect(page.getByTestId("spine-line")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
