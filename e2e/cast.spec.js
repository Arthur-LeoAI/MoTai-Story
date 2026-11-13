// Cast page of the new frontend: character cards. Selectors are data-testid and
// state attributes only; text the test itself supplies may be asserted.
const { test, expect } = require("@playwright/test");

const pageErrors = new WeakMap();
// A failed request is logged by the browser as a console error; tests that
// provoke one on purpose list the status they expect here.
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
  const created = await request.post("/api/works", { data: { focus: "shape", language: "en", title: "Cast test", ...data } });
  expect(created.ok()).toBeTruthy();
  return (await created.json()).work.id;
}

const cards = (page) => page.getByTestId("cast-card");

test("a character is created, shown as a card, edited and kept after a reload", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/cast`);
  await expect(page.getByTestId("cast")).toBeVisible();
  await expect(page.getByTestId("cast-empty")).toBeVisible();
  await expect(cards(page)).toHaveCount(0);

  // A name is required.
  await page.getByTestId("cast-new").click();
  await expect(page.getByTestId("cast-dialog")).toBeVisible();
  await page.getByTestId("cast-save").click();
  await expect(page.getByTestId("cast-error")).toBeVisible();

  await page.getByTestId("cast-name").fill("Mira");
  await page.getByTestId("cast-summary").fill("A mapmaker on the run");
  await page.getByTestId("cast-field-want").fill("To find her sister");
  await page.getByTestId("cast-field-obstacle").fill("The guild that trained her");
  await page.getByTestId("cast-save").click();
  await expect(page.getByTestId("cast-dialog")).toBeHidden();
  await expect(page.getByTestId("cast-empty")).toBeHidden();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId("cast-card-name")).toHaveText("Mira");
  await expect(page.getByTestId("cast-card-summary")).toHaveText("A mapmaker on the run");
  await expect(page.getByTestId("cast-card-want")).toContainText("To find her sister");
  await expect(page.getByTestId("cast-card-obstacle")).toContainText("The guild that trained her");

  // The less common questions are folded away until asked for.
  await cards(page).first().click();
  await expect(page.getByTestId("cast-name")).toHaveValue("Mira");
  await expect(page.getByTestId("cast-field-secret")).toBeHidden();
  await page.getByTestId("cast-more").locator("summary").click();
  await page.getByTestId("cast-field-secret").fill("She drew the map herself");
  await page.getByTestId("cast-aliases").fill("the cartographer， Mi");
  await page.getByTestId("cast-field-want").fill("");
  await page.getByTestId("cast-save").click();
  await expect(page.getByTestId("cast-dialog")).toBeHidden();
  await expect(page.getByTestId("cast-card-want")).toHaveCount(0);

  await page.reload();
  await expect(cards(page)).toHaveCount(1);
  const { canon } = await (await request.get(`/api/works/${workId}/canon`)).json();
  expect(canon.entities).toHaveLength(1);
  expect(canon.entities[0]).toMatchObject({
    type: "character",
    name: "Mira",
    aliases: ["the cartographer", "Mi"],
    summary: "A mapmaker on the run",
    card: { obstacle: "The guild that trained her", secret: "She drew the map herself" },
    revision: 2
  });
  expect(canon.entities[0].card.want).toBeUndefined();
});

test("a card changed in another window is not overwritten", async ({ page, request }) => {
  const workId = await newStory(request);
  const created = await request.post(`/api/works/${workId}/canon/entities`, { data: { type: "character", name: "Kael" } });
  const kael = (await created.json()).item;
  await page.goto(`/app/works/${workId}/cast`);
  await cards(page).first().click();
  await page.getByTestId("cast-summary").fill("Typed here");

  // Meanwhile, another window saves a change.
  expect((await request.patch(`/api/works/${workId}/canon/entities/${kael.id}`, { data: { baseRevision: 1, summary: "Saved elsewhere" } })).ok()).toBeTruthy();

  expectedFailures.get(page).push(409);
  await page.getByTestId("cast-save").click();
  await expect(page.getByTestId("cast-error")).toBeVisible();
  // The writer's own text is still there until they choose otherwise.
  await expect(page.getByTestId("cast-summary")).toHaveValue("Typed here");
  await page.getByTestId("cast-load-saved").click();
  await expect(page.getByTestId("cast-summary")).toHaveValue("Saved elsewhere");
  await expect(page.getByTestId("cast-error")).toBeHidden();
  await page.getByTestId("cast-summary").fill("Typed again");
  await page.getByTestId("cast-save").click();
  await expect(page.getByTestId("cast-dialog")).toBeHidden();
  await expect(page.getByTestId("cast-card-summary")).toHaveText("Typed again");
});

test("deleting a character asks first, then removes the card", async ({ page, request }) => {
  const workId = await newStory(request);
  for (const name of ["Mira", "Voss"]) {
    expect((await request.post(`/api/works/${workId}/canon/entities`, { data: { type: "character", name } })).ok()).toBeTruthy();
  }
  // Other kinds of cards do not appear among the characters.
  expect((await request.post(`/api/works/${workId}/canon/entities`, { data: { type: "location", name: "Fog Harbour" } })).ok()).toBeTruthy();
  await page.goto(`/app/works/${workId}/cast`);
  await expect(cards(page)).toHaveCount(2);

  await cards(page).filter({ hasText: "Voss" }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByTestId("cast-delete").click();
  await expect(page.getByTestId("cast-dialog")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("cast-delete").click();
  await expect(page.getByTestId("cast-dialog")).toBeHidden();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId("cast-card-name")).toHaveText("Mira");
});

test("earlier character notes from story material are shown, and Chinese stories get Chinese text direction", async ({ page, request }) => {
  const workId = await newStory(request, { language: "zh-CN", storyBible: { characters: "林舟：维修学徒" } });
  await page.goto(`/app/works/${workId}/cast`);
  await expect(page.getByTestId("cast-earlier")).toBeVisible();
  await page.getByTestId("cast-earlier").locator("summary").click();
  await expect(page.getByTestId("cast-earlier")).toContainText("林舟：维修学徒");
  await page.getByTestId("cast-new").click();
  await expect(page.getByTestId("cast-name")).toHaveAttribute("lang", "zh-CN");
  await page.getByTestId("cast-cancel").click();
  await expect(page.getByTestId("cast-dialog")).toBeHidden();
});

test("the cast page has no sideways scroll on a phone", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workId = await newStory(request);
  expect((await request.post(`/api/works/${workId}/canon/entities`, { data: { type: "character", name: "A name long enough to need wrapping on a narrow screen", summary: "And a summary that goes on for quite a while to see how it wraps" } })).ok()).toBeTruthy();
  await page.goto(`/app/works/${workId}/cast`);
  await expect(cards(page)).toHaveCount(1);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBeTruthy();
});
