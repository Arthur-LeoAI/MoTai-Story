// New frontend shell (web/, served at /app/). Selectors are data-testid only;
// expected names come from shared/brand.json, never hard-coded copy or colours.
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
const tokenOf = (page, name) => page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);

test("shell switches interface language and keeps the choice", async ({ page }) => {
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

test("shell switches between the paper and candle themes", async ({ page }) => {
  await page.goto("/app/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "paper");
  const paperBackground = await backgroundOf(page);
  expect(await tokenOf(page, "--color-bg")).not.toBe("");

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

test("shell has no horizontal scroll on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/");
  await expect(page.getByTestId("hero")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
