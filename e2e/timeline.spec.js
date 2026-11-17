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

test("the chart shows who takes part in what, by person or by plot line, in the chosen order", async ({ page, request }) => {
  const work = await story(request);
  const [one, two] = work.chapters;
  const person = async (name) => (await (await request.post(`/api/works/${work.id}/canon/entities`, { data: { type: "character", name } })).json()).item;
  const mira = await person("Mira");
  const kael = await person("Kael");
  await person("Voss"); // in no event: no row
  const vanish = await event(request, work.id, { title: "Lysa vanishes", timeLabel: "Three years ago", chapterId: two.id, participantIds: [kael.id] });
  await event(request, work.id, { title: "The map arrives", timeLabel: "Day 1", chapterId: one.id, participantIds: [mira.id] });
  await event(request, work.id, { title: "Kael finds her", timeLabel: "Day 5", participantIds: [mira.id, kael.id] });

  await page.goto(`/app/works/${work.id}/timeline`);
  await page.getByTestId("timeline-order-happened").click();
  const chart = page.getByTestId("timeline-chart");
  await page.getByTestId("chart-rows-people").click();
  await expect(chart).toHaveAttribute("data-rows", "people");
  await expect(chart.getByTestId("chart-column")).toHaveCount(3);
  await expect(chart.getByTestId("chart-row")).toHaveCount(2);
  const hits = async (id) => chart.locator(`[data-testid="chart-row"][data-row-id="${id}"] td`).evaluateAll((cells) => cells.map((cell) => cell.dataset.hit === "true"));
  expect(await hits(mira.id)).toEqual([false, true, true]);
  expect(await hits(kael.id)).toEqual([true, false, true]);

  // As it is told, the columns follow the chapters, and the flashback is marked.
  await page.getByTestId("timeline-order-told").click();
  expect(await hits(kael.id)).toEqual([false, true, true]);
  await expect(chart.getByTestId("chart-column").nth(1)).toContainText("flashback");

  // A plot line: started from an event, then a row of its own.
  await page.getByTestId("chart-rows-threads").click();
  await expect(chart.getByTestId("chart-empty")).toBeVisible();
  await page.locator(`[data-testid="timeline-event"][data-event-id="${vanish.id}"]`).getByTestId("timeline-open").click();
  await page.getByTestId("event-new-thread").fill("Finding the sister");
  await page.getByTestId("event-add-thread").click();
  await expect(page.getByTestId("event-thread")).toHaveCount(1);
  await expect(page.getByTestId("event-thread")).toBeChecked();
  await page.getByTestId("event-save").click();
  await expect(page.getByTestId("event-dialog")).toBeHidden();
  await expect(chart.getByTestId("chart-row")).toHaveCount(1);
  await expect(chart.getByTestId("chart-row")).toContainText("Finding the sister");

  // The column opens its event.
  await chart.getByTestId("chart-column").first().click();
  await expect(page.getByTestId("event-title")).toHaveValue("The map arrives");
  await page.getByTestId("event-cancel").click();

  // The row choice is remembered.
  await page.reload();
  await expect(page.getByTestId("timeline-chart")).toHaveAttribute("data-rows", "threads");
  const { canon } = await (await request.get(`/api/works/${work.id}/canon`)).json();
  expect(canon.threads.map((thread) => thread.name)).toEqual(["Finding the sister"]);
  expect(canon.events.find((item) => item.id === vanish.id).threadIds).toEqual([canon.threads[0].id]);
});

test("a setup is planted, waits as a reminder, shows on the chart, and is paid off", async ({ page, request }) => {
  const work = await story(request);
  const [one, two] = work.chapters;
  await event(request, work.id, { title: "The map arrives", chapterId: one.id });
  const meeting = await event(request, work.id, { title: "The mapmaker is found", chapterId: two.id });
  await page.goto(`/app/works/${work.id}/timeline`);
  await expect(page.getByTestId("timeline-event")).toHaveCount(2);

  await page.getByTestId("setup-new").click();
  await expect(page.getByTestId("setup-dialog")).toBeVisible();
  await page.getByTestId("setup-description").fill("The mark in the corner of the map");
  await page.getByTestId("setup-planted").selectOption(`chapter:${one.id}`);
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setup-dialog")).toBeHidden();

  // Waiting: a reminder, and a line on the chart from chapter 1 to the end.
  const waiting = page.getByTestId("setups-waiting").getByTestId("setup-item");
  await expect(waiting).toHaveCount(1);
  await expect(waiting).toContainText("The mark in the corner of the map");
  const line = page.getByTestId("chart-setup");
  await expect(line).toHaveAttribute("data-status", "open");
  await expect(line.locator("td").nth(0)).toHaveAttribute("data-mark", "planted");
  await expect(line.locator("td").nth(1)).toHaveAttribute("data-mark", "waiting");

  // Paid off in the second event: it leaves the reminders.
  await waiting.click();
  await page.getByTestId("setup-payoff").selectOption(`event:${meeting.id}`);
  await page.getByTestId("setup-status-paid").click();
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setups-waiting")).toHaveCount(0);
  await expect(page.getByTestId("setups-settled").getByTestId("setup-item")).toHaveAttribute("data-status", "paid");
  await expect(line).toHaveAttribute("data-status", "paid");
  await expect(line.locator("td").nth(1)).toHaveAttribute("data-mark", "paid");

  const { canon } = await (await request.get(`/api/works/${work.id}/canon`)).json();
  expect(canon.setups.map((item) => [item.description, item.plantedIn, item.paidOffIn, item.status])).toEqual([
    ["The mark in the corner of the map", { kind: "chapter", id: one.id }, { kind: "event", id: meeting.id }, "paid"]
  ]);
});

test("timeline checks mark a contradiction until it is fixed, and the AI can say what is missing", async ({ page, request }) => {
  const work = await story(request);
  const entity = (data) => request.post(`/api/works/${work.id}/canon/entities`, { data }).then((response) => response.json()).then((body) => body.item);
  const mira = await entity({ type: "character", name: "Mira" });
  const vell = await entity({ type: "location", name: "Vell" });
  const isle = await entity({ type: "location", name: "The Island" });
  const inVell = await event(request, work.id, { title: "Mira hides in Vell", timeLabel: "Day 3", locationId: vell.id, participantIds: [mira.id] });
  const onIsle = await event(request, work.id, { title: "Mira lands on the island", timeLabel: "Day 3", locationId: isle.id, participantIds: [mira.id] });
  await page.goto(`/app/works/${work.id}/timeline`);
  await expect(page.getByTestId("timeline-event")).toHaveCount(2);

  // One person in two places on the same day: said, and both events marked.
  const problem = page.getByTestId("check-problem");
  await expect(problem).toHaveCount(1);
  await expect(problem).toHaveAttribute("data-kind", "twoPlaces");
  await expect(problem).toContainText("Mira hides in Vell");
  await expect(page.locator('[data-testid="timeline-event"][data-problem="true"]')).toHaveCount(2);

  // Fixed from the check itself: the event opens, its day changes, the check goes.
  await problem.getByTestId("check-open").nth(1).click();
  await expect(page.getByTestId("event-dialog")).toBeVisible();
  await expect(page.getByTestId("event-title")).toHaveValue("Mira lands on the island");
  await page.getByTestId("event-when").fill("Day 5");
  await page.getByTestId("event-save").click();
  await expect(page.getByTestId("check-none")).toBeVisible();
  await expect(page.locator('[data-testid="timeline-event"][data-problem="true"]')).toHaveCount(0);

  // What is missing: pointers after an event, nothing saved.
  const before = (await (await request.get(`/api/works/${work.id}/canon`)).json()).canon.canonRevision;
  await page.getByTestId("missing-ask").click();
  const gap = page.getByTestId("missing-gap");
  await expect(gap).toHaveCount(1);
  await expect(gap).toHaveAttribute("data-after", inVell.id);
  await gap.getByTestId("check-open").click();
  await expect(page.getByTestId("event-title")).toHaveValue("Mira hides in Vell");
  await page.getByTestId("event-cancel").click();
  expect((await (await request.get(`/api/works/${work.id}/canon`)).json()).canon.canonRevision).toBe(before);
  expect(onIsle.id).toBeTruthy();
});
