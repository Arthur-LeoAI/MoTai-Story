const { defineConfig } = require("@playwright/test");
const port = Number(process.env.MOTAI_E2E_PORT || 5281);
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.js",
  timeout: 30_000,
  // All specs share one server and one temporary database, and the JSON store
  // rejects overlapping writes (409), so spec files must not run in parallel.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  globalSetup: require.resolve("./e2e/setup.cjs"),
  use: {
    baseURL,
    browserName: "chromium",
    channel: process.env.CI ? undefined : "msedge",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
});
