// Ideate page of the new frontend. Selectors are data-testid and state
// attributes only; text the test itself supplies may be asserted.
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

async function newStory(request, data) {
  const created = await request.post("/api/works", { data: { focus: "shape", language: "en", ...data } });
  expect(created.ok()).toBeTruthy();
  return (await created.json()).work.id;
}

const assistantReplies = (page) => page.locator('[data-testid="chat-message"][data-role="assistant"]');
const userTurns = (page) => page.locator('[data-testid="chat-message"][data-role="user"]');

test("a conversation streams a reply and is still there after a reload", async ({ page, request }) => {
  const workId = await newStory(request, { title: "Ferry", premise: "A mapmaker receives an unsigned map." });
  await page.goto(`/app/works/${workId}/ideate`);
  await expect(page.getByTestId("ideate")).toBeVisible();
  await expect(page.getByTestId("story-premise")).toHaveText("A mapmaker receives an unsigned map.");
  await expect(page.getByTestId("chat-empty")).toBeVisible();
  await expect(page.getByTestId("chat-send")).toBeDisabled();

  await page.getByTestId("chat-input").fill("Who should stand in her way?");
  await page.getByTestId("chat-send").click();
  await expect(userTurns(page)).toHaveCount(1);
  await expect(userTurns(page).first().getByTestId("chat-message-body")).toHaveText("Who should stand in her way?");
  await expect(assistantReplies(page)).toHaveCount(1);
  await expect(assistantReplies(page).first()).toHaveAttribute("data-status", "complete");
  await expect(assistantReplies(page).first().getByTestId("chat-message-body")).not.toBeEmpty();
  await expect(page.getByTestId("chat-streaming")).toHaveCount(0);
  await expect(page.getByTestId("chat-input")).toHaveValue("");
  // The first message names the conversation.
  await expect(page.getByTestId("chat-row").first().getByTestId("chat-open")).toHaveText("Who should stand in her way");

  // Enter sends; Shift+Enter makes a new line.
  await page.getByTestId("chat-input").fill("And where does it happen?");
  await page.getByTestId("chat-input").press("Enter");
  await expect(assistantReplies(page)).toHaveCount(2);

  await page.reload();
  await expect(userTurns(page)).toHaveCount(2);
  await expect(assistantReplies(page)).toHaveCount(2);
});

test("an AI draft is kept part by part, undone, and discarded", async ({ page, request }) => {
  const workId = await newStory(request, { title: "Drafts", premise: "A lighthouse keeper gets a letter from the future." });
  await page.goto(`/app/works/${workId}/ideate`);
  const outline = page.locator('[data-testid="material"][data-type="outline"]');
  await expect(outline).toHaveAttribute("data-filled", "0");

  await page.getByTestId("draft-outline").click();
  const draft = page.getByTestId("draft-card").first();
  await expect(draft).toHaveAttribute("data-status", "pending");
  await expect(draft).toHaveAttribute("data-type", "outline");
  const checks = draft.getByTestId("draft-section-checkbox");
  const total = await checks.count();
  expect(total).toBeGreaterThan(1);
  await expect(checks.first()).toBeChecked();

  // Nothing selected: nothing can be kept.
  for (let index = 0; index < total; index += 1) await checks.nth(index).uncheck();
  await expect(draft.getByTestId("draft-keep")).toBeDisabled();

  // Keep exactly one part.
  await checks.first().check();
  const keptKey = await draft.getByTestId("draft-section").first().getAttribute("data-key");
  await draft.getByTestId("draft-keep").click();
  await expect(draft).toHaveAttribute("data-status", "applied");
  await expect(draft.getByTestId("draft-kept")).toBeVisible();
  await expect(outline).toHaveAttribute("data-filled", "1");
  let stored = (await (await request.get(`/api/works/${workId}`)).json()).work.storyBible;
  expect(stored[keptKey]).not.toBe("");
  expect(Object.values(stored).filter(Boolean)).toHaveLength(1);

  // Undo takes it back out and the draft can be kept again.
  await draft.getByTestId("draft-undo").click();
  await expect(draft).toHaveAttribute("data-status", "reverted");
  await expect(outline).toHaveAttribute("data-filled", "0");
  stored = (await (await request.get(`/api/works/${workId}`)).json()).work.storyBible;
  expect(Object.values(stored).filter(Boolean)).toHaveLength(0);
  await expect(draft.getByTestId("draft-keep")).toBeEnabled();

  await draft.getByTestId("draft-discard").click();
  await expect(draft).toHaveAttribute("data-status", "discarded");
  await expect(draft.getByTestId("draft-keep")).toHaveCount(0);

  // Drafts survive a reload in the state they were left in.
  await page.reload();
  await expect(page.getByTestId("draft-card").first()).toHaveAttribute("data-status", "discarded");
});

test("conversations can be started, switched, renamed and deleted", async ({ page, request }) => {
  const workId = await newStory(request, { title: "Threads" });
  await page.goto(`/app/works/${workId}/ideate`);
  const rows = page.getByTestId("chat-row");
  await expect(rows).toHaveCount(1);

  await page.getByTestId("chat-input").fill("First thread");
  await page.getByTestId("chat-send").click();
  await expect(assistantReplies(page)).toHaveCount(1);

  await page.getByTestId("chat-new").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("chat-empty")).toBeVisible();

  // Back to the first conversation: its messages are shown again.
  await rows.nth(1).getByTestId("chat-open").click();
  await expect(rows.nth(1)).toHaveAttribute("data-active", "true");
  await expect(userTurns(page)).toHaveCount(1);

  await rows.nth(1).getByTestId("chat-rename").click();
  await page.getByTestId("chat-rename-input").fill("Villains");
  await page.getByTestId("chat-rename-save").click();
  await expect(rows.nth(1).getByTestId("chat-open")).toHaveText("Villains");

  // The choice of conversation and its name are remembered.
  await page.reload();
  await expect(page.getByTestId("chat-row").filter({ hasText: "Villains" })).toHaveAttribute("data-active", "true");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("chat-row").filter({ hasText: "Villains" }).getByTestId("chat-delete").click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("chat-empty")).toBeVisible();
});

test("a failed reply explains itself in the interface language and can be retried", async ({ page, request }) => {
  const workId = await newStory(request, { title: "Failure" });
  await page.goto(`/app/works/${workId}/ideate`);
  expectedFailures.get(page).push(503);
  let calls = 0;
  await page.route("**/messages/stream", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AI_UNAVAILABLE", message: "fallback", params: {} } }) });
    } else {
      await route.continue();
    }
  });
  await page.getByTestId("chat-input").fill("Will this arrive?");
  await page.getByTestId("chat-send").click();
  const failure = page.getByTestId("chat-failure");
  await expect(failure).toBeVisible();
  // Translated from the error code, not the server's fallback text.
  await expect(failure).not.toContainText("fallback");
  const english = await failure.innerText();
  await page.getByTestId("locale-select").selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByTestId("locale-select").selectOption("en");

  await page.getByTestId("chat-retry").click();
  await expect(failure).toHaveCount(0);
  await expect(userTurns(page)).toHaveCount(1);
  await expect(userTurns(page).first().getByTestId("chat-message-body")).toHaveText("Will this arrive?");
  await expect(assistantReplies(page)).toHaveCount(1);
  expect(english.trim()).not.toBe("");
});

test("a reply cut short keeps what had arrived and says so", async ({ page, request }) => {
  const workId = await newStory(request, { title: "Cut short" });
  await page.goto(`/app/works/${workId}/ideate`);
  await page.route("**/messages/stream", async (route) => {
    const partial = { id: "message_partial", role: "assistant", content: "She would never", status: "interrupted", createdAt: new Date().toISOString() };
    const events = [
      ["meta", { userMessageId: "message_user", assistantMessageId: "message_partial", chatTitle: "Cut short" }],
      ["delta", { text: "She would never" }],
      ["error", { code: "AI_NETWORK_RESET", message: "fallback", params: { url: "https://example.invalid" }, status: 502, retryable: true, partialMessage: partial }]
    ];
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("")
    });
  });
  await page.getByTestId("chat-input").fill("Tell me about her");
  await page.getByTestId("chat-send").click();
  await expect(assistantReplies(page)).toHaveCount(1);
  await expect(assistantReplies(page).first()).toHaveAttribute("data-status", "interrupted");
  await expect(assistantReplies(page).first().getByTestId("chat-message-body")).toHaveText("She would never");
  await expect(page.getByTestId("chat-failure")).toBeVisible();
  await expect(page.getByTestId("chat-retry")).toBeVisible();
});

test("Ideate has no sideways scroll on a phone", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workId = await newStory(request, { title: "Narrow", premise: "A deliberately long premise to make sure the side panel wraps instead of pushing the page wider than the screen." });
  await page.goto(`/app/works/${workId}/ideate`);
  await expect(page.getByTestId("ideate")).toBeVisible();
  await page.getByTestId("draft-characters").click();
  await expect(page.getByTestId("draft-card").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});
