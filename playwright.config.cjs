const { defineConfig } = require("@playwright/test");
const port = Number(process.env.MOTAI_E2E_PORT || 5281);
const baseURL = `http://127.0.0.1:${port}`;
const nodeExecutable = JSON.stringify(process.execPath);

module.exports = defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.js",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    browserName: "chromium",
    channel: process.env.CI ? undefined : "msedge",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    // Do not assume Node is registered in the Windows PATH during local checks or CI.
    command: `${nodeExecutable} e2e/server.cjs`,
    url: `${baseURL}/api`,
    env: { ...process.env, PORT: String(port) },
    timeout: 30_000,
    reuseExistingServer: process.env.MOTAI_E2E_REUSE === "1"
  }
});
