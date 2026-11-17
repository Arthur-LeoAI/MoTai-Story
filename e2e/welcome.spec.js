// Front door, first-run welcome and sample stories in the new frontend.
// Selectors are data-testid and state attributes only.
const { test, expect } = require("@playwright/test");

const pageErrors = new WeakMap();

test.beforeEach(async ({ page, request }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
  });
  expect((await request.patch("/api/me/preferences", { data: { uiLocale: "en", theme: "paper" } })).ok()).toBeTruthy();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), "No console errors, warnings or missing translation keys").toEqual([]);
});

// A first visit: no stories yet and the welcome not seen. Other specs share the
// database, so the library and the welcome flag are presented as new here.
async function asFirstVisit(page) {
  let welcomed = false;
  // A fixed session (English, paper) so the mock never waits on the network.
  const brand = require("../shared/brand.json");
  await page.route("**/api/session", (route) => route.fulfill({ json: {
    user: { id: "local", kind: "local-dev", displayName: "" },
    brand: { codename: brand.codename },
    preferences: { uiLocale: "en", theme: "paper", welcomedAt: welcomed ? "2026-01-01T00:00:00.000Z" : null, updatedAt: "2026-01-01T00:00:00.000Z" }
  } }));
  await page.route("**/api/works", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({ json: { works: [] } });
  });
  page.on("request", (req) => {
    if (req.url().endsWith("/api/me/preferences") && req.method() === "PATCH" && req.postDataJSON()?.welcomed === true) welcomed = true;
  });
  return () => welcomed;
}

test("the address without a path opens the new interface", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByTestId("hero")).toBeVisible();
});

test("a first visit is welcomed and can open the sample story", async ({ page }) => {
  const wasWelcomed = await asFirstVisit(page);
  await page.goto("/app/");
  const welcome = page.getByTestId("welcome");
  await expect(welcome).toBeVisible();
  await expect(page.getByTestId("welcome-ai")).toHaveAttribute("data-state", "test");

  // Choosing a language here switches the interface at once.
  await page.getByTestId("welcome-locale-zh-CN").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByTestId("welcome-locale-en").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // From here on the real library is used, so the story page can find the new story.
  await page.unroute("**/api/works");
  await page.getByTestId("welcome-sample").click();
  await expect(page).toHaveURL(/\/app\/works\/[^/]+\/write/);
  await expect(page.getByTestId("chapter-item")).toHaveCount(2);
  await expect(page.getByTestId("manuscript-editor")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("manuscript-editor")).not.toBeEmpty();
  expect(wasWelcomed()).toBe(true);
});

test("starting your own story from the welcome focuses the premise", async ({ page }) => {
  await asFirstVisit(page);
  await page.goto("/app/");
  await expect(page.getByTestId("welcome")).toBeVisible();
  await page.getByTestId("welcome-own").click();
  await expect(page.getByTestId("welcome")).toHaveCount(0);
  await expect(page.getByTestId("premise-input")).toBeFocused();

  // Remembered: it does not come back.
  await page.reload();
  await expect(page.getByTestId("hero")).toBeVisible();
  await expect(page.getByTestId("welcome")).toHaveCount(0);
});

test("the welcome can be skipped", async ({ page }) => {
  const wasWelcomed = await asFirstVisit(page);
  await page.goto("/app/");
  await page.getByTestId("welcome-skip").click();
  await expect(page.getByTestId("welcome")).toHaveCount(0);
  expect(wasWelcomed()).toBe(true);
});

test("the sample story is offered in the interface language from the library", async ({ page, request }) => {
  await request.patch("/api/me/preferences", { data: { uiLocale: "zh-CN" } });
  await page.goto("/app/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByTestId("sample-open").click();
  await expect(page).toHaveURL(/\/app\/works\/[^/]+\/write/);
  await expect(page.getByTestId("manuscript-editor")).toHaveAttribute("lang", "zh-CN");
  const workId = new URL(page.url()).pathname.split("/")[3];
  const work = (await (await request.get(`/api/works/${workId}`)).json()).work;
  expect(work).toMatchObject({ language: "zh-CN", sample: true, focus: "write" });
});

test("pages not rebuilt yet point to the previous workspace at /classic/", async ({ page, request }) => {
  const created = await request.post("/api/works", { data: { title: "Classic", language: "en" } });
  const workId = (await created.json()).work.id;
  await page.goto(`/app/works/${workId}/world`);
  await expect(page.getByTestId("legacy-link")).toHaveAttribute("href", "/classic/");
  const classic = await request.get("/classic/");
  expect(classic.ok()).toBeTruthy();
});
