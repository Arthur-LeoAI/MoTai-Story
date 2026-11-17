// Timeline page of the new frontend. Selectors are data-testid and state
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
  const created = await request.post("/api/works", { data: { focus: "shape", language: "en", title: "Timeline test" } });
  const { work } = await created.json();
  // A second chapter, so events can be told in different chapters.
  const added = await request.post(`/api/works/${work.id}/chapters`, { data: { title: "Chapter 2" } });
  expect(added.ok()).toBeTruthy();
  return (await (await request.get(`/api/works/${work.id}`)).json()).work;
}

const event = (request, workId, data) => request.post(`/api/works/${workId}/canon/events`, { data }).then((response) => response.json()).then((body) => body.item);
const titles = (page) => page.getByTestId("timeline-title").allInnerTexts();

test("events are added in a sentence, edited, put in order, and deleted", async ({ page, request }) => {
  const work = await story(request);
  const mira = (await (await request.post(`/api/works/${work.id}/canon/entities`, { data: { type: "character", name: "Mira" } })).json()).item;
  await page.goto(`/app/works/${work.id}/timeline`);
  await expect(page.getByTestId("timeline-empty")).toBeVisible();

  await page.getByTestId("event-quick").fill("An unsigned map reaches Mira");
  await page.getByTestId("event-quick-add").click();
  await page.getByTestId("event-quick").fill("Kael receives the warrant");
  await page.getByTestId("event-quick").press("Enter");
  await expect(page.getByTestId("timeline-event")).toHaveCount(2);
  expect(await titles(page)).toEqual(["An unsigned map reaches Mira", "Kael receives the warrant"]);

  // Edit: when, who, and which chapter tells it.
  await page.getByTestId("timeline-open").first().click();
  await expect(page.getByTestId("event-dialog")).toBeVisible();
  await page.getByTestId("event-when").fill("Day 1");
  await page.locator(`[data-testid="event-participant"][data-entity-id="${mira.id}"]`).check();
  await page.getByTestId("event-chapter").selectOption(work.chapters[0].id);
  await page.getByTestId("event-save").click();
  await expect(page.getByTestId("event-dialog")).toBeHidden();
  await expect(page.getByTestId("timeline-event").first()).toContainText("Day 1");
  await expect(page.getByTestId("timeline-event").first()).toContainText("Mira");

  // Reorder in story order.
  await page.getByTestId("event-down").first().click();
  await expect.poll(() => titles(page)).toEqual(["Kael receives the warrant", "An unsigned map reaches Mira"]);
  await page.reload();
  await expect(page.getByTestId("timeline-event")).toHaveCount(2);
  expect(await titles(page)).toEqual(["Kael receives the warrant", "An unsigned map reaches Mira"]);

  // Delete asks first.
  await page.getByTestId("timeline-open").first().click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("event-delete").click();
  await expect(page.getByTestId("timeline-event")).toHaveCount(1);
  const { canon } = await (await request.get(`/api/works/${work.id}/canon`)).json();
  expect(canon.events.map((item) => [item.title, item.timeLabel, item.participantIds, item.chapterId])).toEqual([["An unsigned map reaches Mira", "Day 1", [mira.id], work.chapters[0].id]]);
});

test("told in a later chapter, an earlier event reads as a flashback", async ({ page, request }) => {
  const work = await story(request);
  const [one, two] = work.chapters;
  // Story order: the vanishing happens first, but chapter 2 tells it.
  await event(request, work.id, { title: "Lysa vanishes at the border", timeLabel: "Three years ago", chapterId: two.id });
  await event(request, work.id, { title: "An unsigned map reaches Mira", timeLabel: "Day 1", chapterId: one.id });
  await event(request, work.id, { title: "Mira learns who drew it" });

  await page.goto(`/app/works/${work.id}/timeline`);
  await page.getByTestId("timeline-order-happened").click();
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-order", "happened");
  await expect(page.getByTestId("timeline-event")).toHaveCount(3);
  expect(await titles(page)).toEqual(["Lysa vanishes at the border", "An unsigned map reaches Mira", "Mira learns who drew it"]);
  // As it happened, each event says which chapter tells it.
  await expect(page.getByTestId("timeline-event").first().getByTestId("timeline-sub").first()).toContainText("Chapter 2");

  await page.getByTestId("timeline-order-told").click();
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-order", "told");
  // Chapter 1, then chapter 2, then what no chapter tells yet.
  expect(await titles(page)).toEqual(["An unsigned map reaches Mira", "Lysa vanishes at the border", "Mira learns who drew it"]);
  const flashback = page.locator('[data-testid="timeline-event"][data-flashback="true"]');
  await expect(flashback).toHaveCount(1);
  await expect(flashback.getByTestId("timeline-sub").first()).toContainText("Three years ago");
  await expect(page.locator('[data-testid="timeline-event"][data-told="false"]')).toContainText("Mira learns who drew it");
  // Told order follows the chapters: nothing to move by hand.
  await expect(page.getByTestId("event-up")).toHaveCount(0);

  // The chosen order is remembered.
  await page.reload();
  await expect(page.getByTestId("timeline")).toHaveAttribute("data-order", "told");
});

test("the timeline has no sideways scroll on a phone", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const work = await story(request);
  await event(request, work.id, { title: "A rather long event title that has to wrap on a narrow phone screen without spilling over", timeLabel: "Three years before the story begins" });
  await page.goto(`/app/works/${work.id}/timeline`);
  await expect(page.getByTestId("timeline-event")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
