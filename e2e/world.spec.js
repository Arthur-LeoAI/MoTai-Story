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

test("stress-testing a rule asks questions, and the answers become a draft that is kept only when saved", async ({ page, request }) => {
  const work = await story(request);
  const rule = (await (await request.post(`/api/works/${work.id}/canon/entities`, { data: { type: "rule", name: "The tide never turns at night" } })).json()).item;
  await page.goto(`/app/works/${work.id}/world`);
  await page.getByTestId("rule-card").click();
  await expect(page.getByTestId("rule-stress")).toBeVisible();

  // Unsaved changes come first.
  await page.getByTestId("rule-cost").fill("Ships wait in harbour until dawn");
  await expect(page.getByTestId("rule-stress-ask")).toBeDisabled();
  await page.getByTestId("rule-cost").fill("");
  await page.getByTestId("rule-stress-ask").click();
  const questions = page.getByTestId("rule-stress-question");
  await expect(questions).toHaveCount(3);

  await expect(page.getByTestId("rule-stress-fold")).toBeDisabled();
  await page.getByTestId("rule-stress-answer").first().fill("Only the harbour priests know why");
  await page.getByTestId("rule-stress-fold").click();
  await expect(page.getByTestId("rule-stress-folded")).toBeVisible();
  await expect(page.getByTestId("rule-exception")).toHaveValue(/Only the harbour priests know why/);

  // Nothing saved yet.
  const before = (await (await request.get(`/api/works/${work.id}/canon`)).json()).canon.entities.find((entity) => entity.id === rule.id);
  expect(before.card.exception ?? "").toBe("");
  await page.getByTestId("rule-save").click();
  await expect(page.getByTestId("rule-dialog")).toBeHidden();
  await expect(page.getByTestId("rule-card")).toContainText("Only the harbour priests know why");
});

test("places are arranged inside each other, and a place deleted lets the ones inside move up", async ({ page, request }) => {
  const work = await story(request);
  await page.goto(`/app/works/${work.id}/world`);
  await expect(page.getByTestId("places-empty")).toBeVisible();

  await page.getByTestId("place-new").click();
  await page.getByTestId("place-name").fill("The Drowned Coast");
  await page.getByTestId("place-save").click();
  await expect(page.getByTestId("place-row")).toHaveCount(1);

  // "Add inside" opens a new place already inside this one.
  await page.getByTestId("place-add-inside").click();
  await page.getByTestId("place-name").fill("Vell");
  await page.getByTestId("place-summary").fill("A harbour city of stairs and wet stone");
  await page.getByTestId("place-save").click();
  await expect(page.getByTestId("place-row")).toHaveCount(2);
  const vell = page.locator('[data-testid="place-row"]', { hasText: "Vell" });
  await expect(vell).toHaveAttribute("data-depth", "1");

  await vell.getByTestId("place-add-inside").click();
  await page.getByTestId("place-name").fill("The Archive");
  await page.getByTestId("place-save").click();
  const archive = page.locator('[data-testid="place-row"]', { hasText: "The Archive" });
  await expect(archive).toHaveAttribute("data-depth", "2");

  // A place cannot be moved inside a place within it.
  await page.locator('[data-testid="place-row"]', { hasText: "The Drowned Coast" }).getByTestId("place-open").click();
  const options = await page.getByTestId("place-parent").locator("option").allInnerTexts();
  expect(options.map((option) => option.trim())).toEqual([expect.any(String)]);
  await page.getByTestId("place-cancel").click();

  await vell.getByTestId("place-open").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("place-delete").click();
  await expect(page.getByTestId("place-row")).toHaveCount(2);
  await expect(archive).toHaveAttribute("data-depth", "1");
});

test("factions have cards, and their stances change with a click", async ({ page, request }) => {
  const work = await story(request);
  await page.goto(`/app/works/${work.id}/world`);
  for (const [name, want] of [["The Governor's Wardens", "Every chart of the coast"], ["The Smugglers' Guild", "Free passage at night"]]) {
    await page.getByTestId("faction-new").click();
    await page.getByTestId("faction-name").fill(name);
    await page.getByTestId("faction-want").fill(want);
    await page.getByTestId("faction-save").click();
    await expect(page.getByTestId("faction-dialog")).toBeHidden();
  }
  await expect(page.getByTestId("faction-card")).toHaveCount(2);
  await expect(page.getByTestId("faction-card").first()).toContainText("Every chart of the coast");

  // Neutral → allies → enemies → neutral; both cells of the pair agree.
  const cells = page.getByTestId("stance-cell");
  await expect(cells).toHaveCount(2);
  await expect(cells.first()).toHaveAttribute("data-stance", "neutral");
  await cells.first().click();
  await expect(cells.first()).toHaveAttribute("data-stance", "ally");
  await expect(cells.last()).toHaveAttribute("data-stance", "ally");
  await cells.last().click();
  await expect(cells.first()).toHaveAttribute("data-stance", "enemy");
  const relations = (await (await request.get(`/api/works/${work.id}/canon`)).json()).canon.relations;
  expect(relations.map((relation) => relation.kind)).toEqual(["enemy"]);
  await cells.first().click();
  await expect(cells.first()).toHaveAttribute("data-stance", "neutral");
  await expect.poll(async () => (await (await request.get(`/api/works/${work.id}/canon`)).json()).canon.relations.length).toBe(0);
});

test("names from the cards are underlined in the manuscript, show their card, and open it", async ({ page, request }) => {
  const work = await story(request);
  const entity = (data) => request.post(`/api/works/${work.id}/canon/entities`, { data }).then((response) => response.json()).then((body) => body.item);
  await entity({ type: "character", name: "Mira", aliases: ["the cartographer"], summary: "A mapmaker who draws routes for smugglers" });
  const archive = await entity({ type: "location", name: "The Archive", summary: "Old charts, older dust" });
  const full = (await (await request.get(`/api/works/${work.id}`)).json()).work;
  const chapter = full.chapters[0];
  const text = "Mira reached the Archive before dawn. Miracles were rare, but the cartographer did not need one.";
  expect((await request.patch(`/api/works/${work.id}/chapters/${chapter.id}`, { data: { baseRevision: chapter.revision, content: text } })).ok()).toBeTruthy();

  await page.goto(`/app/works/${work.id}/write?chapter=${chapter.id}`);
  await expect(page.getByTestId("manuscript-editor")).toContainText("Miracles");
  // Whole names only, a leading "The" in either case, aliases too; never inside "Miracles".
  await expect.poll(() => page.evaluate(() => [...(CSS.highlights.get("sumitale-names") ?? [])].map((range) => range.toString()))).toEqual(["Mira", "the Archive", "the cartographer"]);

  // Resting the pointer on a name shows its card.
  const box = await page.evaluate(() => {
    const range = [...CSS.highlights.get("sumitale-names")].find((item) => item.toString() === "the Archive");
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  const card = page.getByTestId("name-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-entity-id", archive.id);
  await expect(card).toContainText("Old charts, older dust");

  // The text itself is not changed by any of this.
  const saved = (await (await request.get(`/api/works/${work.id}`)).json()).work.chapters[0];
  expect(saved.content.trim()).toBe(text);
  expect(saved.revision).toBe(chapter.revision + 1);

  // "Open card" opens the place on the World page.
  await card.getByTestId("name-card-open").click();
  await expect(page).toHaveURL(new RegExp(`/works/${work.id}/world$`));
  await expect(page.getByTestId("place-dialog")).toBeVisible();
  await expect(page.getByTestId("place-name")).toHaveValue("The Archive");
});
