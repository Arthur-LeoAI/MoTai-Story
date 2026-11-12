// New frontend (web/, served at /app/). Selectors are data-testid and state
// attributes only; expected names come from shared/brand.json, never
// hard-coded interface copy or colours. Text the test itself supplies (story
// premises) may be asserted.
const { test, expect } = require("@playwright/test");
const brand = require("../shared/brand.json");

const pageErrors = new WeakMap();

test.beforeEach(async ({ page, request }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  // Missing translation keys are reported with console.error (web/src/i18n.ts).
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
  });
  // The E2E server keeps one temporary database for the whole run: start each
  // test from the same saved preferences.
  const reset = await request.patch("/api/me/preferences", { data: { uiLocale: "en", theme: "paper" } });
  expect(reset.ok()).toBeTruthy();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "No console errors, warnings or missing translation keys").toEqual([]);
});

const backgroundOf = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("interface language switches and is remembered", async ({ page }) => {
  await page.goto("/app/");
  const html = page.locator("html");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(html).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("brand-wordmark")).toHaveText(brand.name.default);
  await expect(page).toHaveTitle(brand.name.default);
  const englishHeading = await page.getByTestId("hero-title").innerText();
  expect(englishHeading.trim()).not.toBe("");

  await page.getByTestId("locale-select").selectOption("zh-CN");
  await expect(html).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByTestId("brand-wordmark")).toHaveText(brand.name["zh-CN"]);
  await expect(page).toHaveTitle(brand.name["zh-CN"]);
  await expect(page.getByTestId("hero-title")).not.toHaveText(englishHeading);

  // Saved for this user on the server and survives a reload.
  await expect.poll(async () => (await (await page.request.get("/api/me/preferences")).json()).preferences.uiLocale).toBe("zh-CN");
  await page.reload();
  await expect(html).toHaveAttribute("lang", "zh-CN");

  await page.getByTestId("locale-select").selectOption("en");
  await expect(html).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("hero-title")).toHaveText(englishHeading);
});

test("paper and candle themes switch and are remembered", async ({ page }) => {
  await page.goto("/app/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "paper");
  const paperBackground = await backgroundOf(page);

  await page.getByTestId("theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "candle");
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => backgroundOf(page)).not.toBe(paperBackground);

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "candle");

  await page.getByTestId("theme-toggle").click();
  await expect(html).toHaveAttribute("data-theme", "paper");
  await expect.poll(() => backgroundOf(page)).toBe(paperBackground);
});

test("fonts are served by the app and licence notices ship with them", async ({ page, request }) => {
  const fontRequests = [];
  page.on("request", (req) => { if (req.resourceType() === "font") fontRequests.push(req.url()); });
  await page.goto("/app/");
  await page.evaluate(() => document.fonts.ready);
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const url of fontRequests) expect(new URL(url).pathname).toMatch(/^\/app\/assets\//);
  const notices = await request.get("/app/licenses/fonts.txt");
  expect(notices.ok()).toBeTruthy();
  expect(await notices.text()).toContain("SIL OPEN FONT LICENSE Version 1.1");
});

test("a Shape story starts from one sentence and opens in Ideate", async ({ page }) => {
  await page.goto("/app/");
  await expect(page.getByTestId("path-shape")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("path-write")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("premise-input").fill("A mapmaker receives an unsigned map.");
  await page.getByTestId("begin-button").click();

  await expect(page).toHaveURL(/\/app\/works\/[^/]+\/ideate$/);
  const frame = page.getByTestId("work-frame");
  await expect(frame).toHaveAttribute("data-focus", "shape");
  await expect(page.getByTestId("nav-ideate")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("ideate")).toBeVisible();
  await expect(page.getByTestId("story-premise")).toHaveText("A mapmaker receives an unsigned map.");
  // Shape stories list the six pages in plan order.
  await expect(frame.locator('[data-testid^="nav-"]').first()).toHaveAttribute("data-testid", "nav-ideate");

  // Every page is reachable; nothing is locked by the focus.
  for (const section of ["cast", "world", "timeline", "plot"]) {
    await page.getByTestId(`nav-${section}`).click();
    await expect(page.getByTestId("section-placeholder")).toHaveAttribute("data-section", section);
    await expect(page.getByTestId(`nav-${section}`)).toHaveAttribute("aria-current", "page");
  }
  await page.getByTestId("nav-write").click();
  await expect(page.getByTestId("manuscript")).toBeVisible();
  await expect(page.getByTestId("nav-write")).toHaveAttribute("aria-current", "page");

  // The story is in the library, written in the interface language by default.
  const workId = new URL(page.url()).pathname.split("/")[3];
  await page.getByTestId("brand-wordmark").click();
  const card = page.locator(`[data-testid="work-card"][data-work-id="${workId}"]`);
  await expect(card).toHaveAttribute("data-focus", "shape");
  const stored = (await (await page.request.get(`/api/works/${workId}`)).json()).work;
  expect(stored.language).toBe("en");
  expect(stored.premise).toBe("A mapmaker receives an unsigned map.");
  expect(stored.ownerId).toBe("local");
});

test("a Write story keeps its own language and opens in Write", async ({ page }) => {
  await page.goto("/app/");
  await page.getByTestId("path-write").click();
  await expect(page.getByTestId("path-write")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("path-shape")).toHaveAttribute("aria-pressed", "false");
  // English interface, Chinese story.
  await page.getByTestId("story-language-select").selectOption("zh-CN");
  await page.getByTestId("premise-input").fill("守灯人收到未来寄来的求救信。");
  await page.getByTestId("begin-button").click();

  // The open chapter is part of the address (?chapter=…).
  await expect(page).toHaveURL(/\/app\/works\/[^/]+\/write(\?|$)/);
  const frame = page.getByTestId("work-frame");
  await expect(frame).toHaveAttribute("data-focus", "write");
  // Write stories list the manuscript first.
  await expect(frame.locator('[data-testid^="nav-"]').first()).toHaveAttribute("data-testid", "nav-write");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("story-title")).toHaveAttribute("lang", "zh-CN");

  const workId = new URL(page.url()).pathname.split("/")[3];
  const stored = (await (await page.request.get(`/api/works/${workId}`)).json()).work;
  expect(stored.language).toBe("zh-CN");

  // A reload lands on the same page (client-side routes are served by the app).
  await page.reload();
  await expect(page.getByTestId("nav-write")).toHaveAttribute("aria-current", "page");

  // The library card continues where the story opens.
  await page.goto("/app/");
  const card = page.locator(`[data-testid="work-card"][data-work-id="${workId}"]`);
  await card.getByTestId("work-continue").click();
  await expect(page).toHaveURL(new RegExp(`/app/works/${workId}/write(\\?|$)`));
});

test("unknown stories and pages show a way back", async ({ page }) => {
  await page.goto("/app/works/work_missing/write");
  await expect(page.getByTestId("not-found")).toBeVisible();
  await page.getByTestId("back-home").click();
  await expect(page.getByTestId("hero")).toBeVisible();
  await page.goto("/app/nowhere");
  await expect(page.getByTestId("not-found")).toBeVisible();
});

test("home and story pages have no sideways scroll on a phone", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const created = await request.post("/api/works", { data: { title: "A deliberately long story title to test wrapping on narrow screens", language: "en", focus: "write" } });
  const workId = (await created.json()).work.id;
  await page.goto("/app/");
  await expect(page.getByTestId("hero")).toBeVisible();
  await expect(page.locator(`[data-work-id="${workId}"]`)).toBeVisible();
  expect(await noSidewaysScroll(page)).toBeTruthy();
  await page.goto(`/app/works/${workId}/write`);
  await expect(page.getByTestId("manuscript")).toBeVisible();
  expect(await noSidewaysScroll(page)).toBeTruthy();
});
