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
  await expect(page.getByTestId("relations-map")).toHaveCount(0);

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
  // The map is the first view; the new character is selected beside it.
  await expect(page.getByTestId("cast")).toHaveAttribute("data-view", "relations");
  await expect(page.getByTestId("relations-node")).toHaveCount(1);
  await expect(page.getByTestId("cast-panel-name")).toHaveText("Mira");
  await expect(page.getByTestId("cast-panel-want")).toContainText("To find her sister");
  await page.getByTestId("cast-view-portraits").click();
  await expect(page.getByTestId("cast")).toHaveAttribute("data-view", "portraits");
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId("cast-card-name")).toHaveText("Mira");
  await expect(page.getByTestId("cast-card-summary")).toHaveText("A mapmaker on the run");
  await expect(page.getByTestId("cast-card-want")).toContainText("To find her sister");
  await expect(page.getByTestId("cast-card-obstacle")).toContainText("The guild that trained her");

  // The less common questions are folded away until asked for.
  await page.getByTestId("cast-edit").click();
  await expect(page.getByTestId("cast-name")).toHaveValue("Mira");
  await expect(page.getByTestId("cast-field-secret")).toBeHidden();
  await page.getByTestId("cast-more").locator("summary").click();
  await page.getByTestId("cast-field-secret").fill("She drew the map herself");
  await page.getByTestId("cast-aliases").fill("the cartographer， Mi");
  await page.getByTestId("cast-field-want").fill("");
  await page.getByTestId("cast-save").click();
  await expect(page.getByTestId("cast-dialog")).toBeHidden();
  await expect(page.getByTestId("cast-card-want")).toHaveCount(0);

  // The chosen view is remembered.
  await page.reload();
  await expect(page.getByTestId("cast")).toHaveAttribute("data-view", "portraits");
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
  await page.getByTestId("cast-edit").click();
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
  await expect(page.getByTestId("cast-panel")).toContainText("Typed again");
});

test("deleting a character asks first, then removes the card", async ({ page, request }) => {
  const workId = await newStory(request);
  for (const name of ["Mira", "Voss"]) {
    expect((await request.post(`/api/works/${workId}/canon/entities`, { data: { type: "character", name } })).ok()).toBeTruthy();
  }
  // Other kinds of cards do not appear among the characters.
  expect((await request.post(`/api/works/${workId}/canon/entities`, { data: { type: "location", name: "Fog Harbour" } })).ok()).toBeTruthy();
  await page.goto(`/app/works/${workId}/cast`);
  await page.getByTestId("cast-view-portraits").click();
  await expect(cards(page)).toHaveCount(2);

  await cards(page).filter({ hasText: "Voss" }).click();
  await expect(cards(page).filter({ hasText: "Voss" })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("cast-edit").click();
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
  await page.getByTestId("cast-view-relations").click();
  await expect(page.getByTestId("relations-map")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByTestId("cast-view-portraits").click();
  await expect(cards(page)).toHaveCount(1);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBeTruthy();
});

async function character(request, workId, name, extra = {}) {
  const created = await request.post(`/api/works/${workId}/canon/entities`, { data: { type: "character", name, ...extra } });
  expect(created.ok()).toBeTruthy();
  return (await created.json()).item;
}

async function dragBetween(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 10, { steps: 4 });
  await expect(page.getByTestId("relations-drawing")).toHaveCount(1);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

const node = (page, entity) => page.locator(`[data-testid="relations-node"][data-node-id="${entity.id}"]`);

test("drawing from one portrait to another creates a relationship", async ({ page, request }) => {
  const workId = await newStory(request);
  const mira = await character(request, workId, "Mira");
  const kael = await character(request, workId, "Kael");
  await page.goto(`/app/works/${workId}/cast`);
  await page.getByTestId("cast-view-relations").click();
  await expect(page.getByTestId("relations-node")).toHaveCount(2);
  await expect(page.getByTestId("relation-label")).toHaveCount(0);

  await dragBetween(page, node(page, kael), node(page, mira));
  await expect(page.getByTestId("relation-dialog")).toBeVisible();
  await expect(page.getByTestId("relation-from")).toHaveText("Kael");
  await expect(page.getByTestId("relation-to")).toHaveText("Mira");
  await expect(page.getByTestId("relations-drawing")).toHaveCount(0);
  await page.getByTestId("relation-kind-mentor").click();
  await expect(page.getByTestId("relation-kind-mentor")).toHaveAttribute("data-state", "on");
  await page.getByTestId("relation-swap").click();
  await expect(page.getByTestId("relation-from")).toHaveText("Mira");
  await page.getByTestId("relation-tension").fill("She taught him everything he now uses against her");
  await page.getByTestId("relation-save").click();
  await expect(page.getByTestId("relation-dialog")).toBeHidden();
  await expect(page.getByTestId("relation-label")).toHaveCount(1);
  await expect(page.getByTestId("relation-label")).toHaveText("Mentor");

  // A plain click on a portrait selects it; it does not start a line.
  await node(page, kael).click();
  await expect(node(page, kael)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("cast-panel-name")).toHaveText("Kael");
  await expect(page.getByTestId("cast-relation")).toHaveCount(1);
  await expect(page.getByTestId("relation-dialog")).toBeHidden();

  const { canon } = await (await request.get(`/api/works/${workId}/canon`)).json();
  expect(canon.relations).toHaveLength(1);
  expect(canon.relations[0]).toMatchObject({ fromId: mira.id, toId: kael.id, kind: "mentor", tension: "She taught him everything he now uses against her" });
});

test("relationships can be added without dragging, changed, and removed", async ({ page, request }) => {
  const workId = await newStory(request);
  await character(request, workId, "Mira");
  const kael = await character(request, workId, "Kael");
  await page.goto(`/app/works/${workId}/cast`);
  await page.getByTestId("cast-view-relations").click();
  await expect(page.getByTestId("cast-panel-name")).toHaveText("Mira");
  await expect(page.getByTestId("relation-add")).toBeDisabled();

  // The keyboard path: choose the other person beside the map.
  await page.getByTestId("relation-add-target").selectOption(kael.id);
  await page.getByTestId("relation-add").click();
  await page.getByTestId("relation-kind-custom").click();
  await expect(page.getByTestId("relation-kind-custom")).toHaveAttribute("data-state", "on");
  await page.getByTestId("relation-label-input").fill("old friends");
  await page.getByTestId("relation-save").click();
  await expect(page.getByTestId("relation-label")).toHaveText("old friends");

  // A second relationship between the same two people gets its own line and label.
  await page.getByTestId("relation-add-target").selectOption(kael.id);
  await page.getByTestId("relation-add").click();
  await page.getByTestId("relation-kind-enemy").click();
  await expect(page.getByTestId("relation-kind-enemy")).toHaveAttribute("data-state", "on");
  await page.getByTestId("relation-save").click();
  await expect(page.getByTestId("relation-label")).toHaveCount(2);
  const [first, second] = await Promise.all([0, 1].map((index) => page.getByTestId("relation-label").nth(index).boundingBox()));
  const overlap = !(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y);
  expect(overlap, "labels of parallel relationships do not cover each other").toBeFalsy();

  // Change one from its label on the map.
  await page.getByTestId("relation-label").filter({ hasText: "old friends" }).click();
  await expect(page.getByTestId("relation-label-input")).toHaveValue("old friends");
  await page.getByTestId("relation-label-input").fill("hunter and quarry");
  await page.getByTestId("relation-save").click();
  await expect(page.getByTestId("relation-label").filter({ hasText: "hunter and quarry" })).toHaveCount(1);

  // Remove the other from the side panel.
  await page.getByTestId("cast-relation").filter({ hasText: "Enemies" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("relation-delete").click();
  await expect(page.getByTestId("relation-label")).toHaveCount(1);
  await expect(page.getByTestId("cast-relation")).toHaveCount(1);
});

test("deleting a character also removes the lines drawn to them", async ({ page, request }) => {
  const workId = await newStory(request);
  await character(request, workId, "Mira");
  const voss = await character(request, workId, "Voss");
  const mira = (await (await request.get(`/api/works/${workId}/canon`)).json()).canon.entities.find((entity) => entity.name === "Mira");
  expect((await request.post(`/api/works/${workId}/canon/relations`, { data: { fromId: voss.id, toId: mira.id, kind: "enemy" } })).ok()).toBeTruthy();
  await page.goto(`/app/works/${workId}/cast`);
  await page.getByTestId("cast-view-relations").click();
  await expect(page.getByTestId("relation-label")).toHaveCount(1);
  await node(page, voss).click();
  await page.getByTestId("cast-edit").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("cast-delete").click();
  await expect(page.getByTestId("relations-node")).toHaveCount(1);
  await expect(page.getByTestId("relation-label")).toHaveCount(0);
  await expect(page.getByTestId("cast-panel-name")).toHaveText("Mira");
});

test("a character sketched from one sentence opens as a draft and is saved only when the writer saves it", async ({ page, request }) => {
  const workId = await newStory(request);
  await page.goto(`/app/works/${workId}/cast`);
  await expect(page.getByTestId("cast-empty")).toBeVisible();
  await expect(page.getByTestId("cast-sketch-submit")).toBeDisabled();
  await page.getByTestId("cast-sketch-input").fill("Kael, her oldest friend, now a warden");
  await page.getByTestId("cast-sketch-submit").click();

  await expect(page.getByTestId("cast-dialog")).toBeVisible();
  await expect(page.getByTestId("cast-draft-note")).toBeVisible();
  await expect(page.getByTestId("cast-name")).toHaveValue("Kael");
  await expect(page.getByTestId("cast-summary")).toHaveValue("Kael, her oldest friend, now a warden");
  // Closing the draft keeps nothing.
  await page.getByTestId("cast-cancel").click();
  await expect(page.getByTestId("cast-empty")).toBeVisible();
  expect((await (await request.get(`/api/works/${workId}/canon`)).json()).canon.entities).toHaveLength(0);

  await page.getByTestId("cast-sketch-input").fill("Kael, her oldest friend, now a warden");
  await page.getByTestId("cast-sketch-submit").click();
  await page.getByTestId("cast-field-change").fill("He chooses her over his oath");
  await page.getByTestId("cast-save").click();
  await expect(page.getByTestId("cast-dialog")).toBeHidden();
  await expect(page.getByTestId("cast-panel-name")).toHaveText("Kael");
  await expect(page.getByTestId("cast-panel-change")).toContainText("He chooses her over his oath");
  // With someone in Cast, the sentence box sits beside the map.
  await expect(page.getByTestId("cast-panel").getByTestId("cast-sketch")).toBeVisible();
});

test("people and events found in the manuscript are added only when ticked", async ({ page, request }) => {
  const workId = await newStory(request, { focus: "write" });
  const work = (await (await request.get(`/api/works/${workId}`)).json()).work;
  const chapter = work.chapters[0];
  expect((await request.patch(`/api/works/${workId}/chapters/${chapter.id}`, { data: { baseRevision: chapter.revision, content: "Mira waited at the ferry, and then Kael came down the path while Voss watched." } })).ok()).toBeTruthy();
  await character(request, workId, "Mira");

  await page.goto(`/app/works/${workId}/cast`);
  await page.getByTestId("extract-start").first().click();
  const dialog = page.getByTestId("extract-dialog");
  await expect(dialog).toBeVisible({ timeout: 15000 });
  // Mira is already in Cast, so she is not offered again.
  await expect(dialog.getByTestId("extract-character")).toHaveCount(2);
  await expect(dialog.locator('[data-testid="extract-character"][data-name="Mira"]')).toHaveCount(0);
  expect((await (await request.get(`/api/works/${workId}/canon`)).json()).canon.entities).toHaveLength(1);

  // Leaving Voss out also rules out the relationship that needs him.
  await dialog.locator('[data-testid="extract-character"][data-name="Voss"] input').uncheck();
  await expect(dialog.getByTestId("extract-relation").first()).toHaveAttribute("data-state", "missing");
  await dialog.getByTestId("extract-add").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("extract-notice").first()).toBeVisible();

  const { canon } = await (await request.get(`/api/works/${workId}/canon`)).json();
  expect(canon.entities.map((entity) => entity.name).sort()).toEqual(["Kael", "Mira"]);
  expect(canon.relations).toHaveLength(0);
  expect(canon.events).toHaveLength(1);
  expect(canon.events[0].chapterId).toBe(chapter.id);
  await expect(page.getByTestId("relations-node")).toHaveCount(2);
});

test("relationships hold between chapters, and the map shows how things stand as of each chapter", async ({ page, request }) => {
  // The last save is refused on purpose (it would end before it begins).
  expectedFailures.get(page).push(400);
  const workId = await newStory(request);
  for (const title of ["The Archive", "The Island"]) await request.post(`/api/works/${workId}/chapters`, { data: { title } });
  const chapters = (await (await request.get(`/api/works/${workId}`)).json()).work.chapters;
  const mira = await character(request, workId, "Mira");
  const kael = await character(request, workId, "Kael");
  // Friends through chapter 1, set in the dialog; enemies from chapter 2.
  await request.post(`/api/works/${workId}/canon/relations`, { data: { fromId: mira.id, toId: kael.id, kind: "friend" } });
  await request.post(`/api/works/${workId}/canon/relations`, { data: { fromId: mira.id, toId: kael.id, kind: "enemy", fromChapterId: chapters[1].id } });
  await page.goto(`/app/works/${workId}/cast`);
  await page.getByTestId("cast-view-relations").click();
  const labels = page.getByTestId("relation-label");
  await expect(labels).toHaveCount(2);

  await labels.filter({ hasText: "Friends" }).click();
  await page.getByTestId("relation-until-chapter").selectOption(chapters[0].id);
  await page.getByTestId("relation-save").click();
  await expect(page.getByTestId("relation-dialog")).toBeHidden();

  // The whole story shows both; chapter 1 only the friendship; chapter 3 only the enmity.
  const slider = page.getByTestId("relmap-progress");
  await slider.fill("1");
  await expect(page.getByTestId("relmap-as-of")).toContainText("chapter 1");
  await expect(labels).toHaveCount(1);
  await expect(labels).toContainText("Friends");
  await slider.fill("3");
  await expect(labels).toHaveCount(1);
  await expect(labels).toContainText("Enemies");
  await slider.fill("0");
  await expect(labels).toHaveCount(2);

  // A relationship cannot end before it begins.
  await labels.filter({ hasText: "Enemies" }).click();
  await page.getByTestId("relation-until-chapter").selectOption(chapters[0].id);
  await page.getByTestId("relation-save").click();
  await expect(page.getByTestId("relation-error")).toBeVisible();
});
