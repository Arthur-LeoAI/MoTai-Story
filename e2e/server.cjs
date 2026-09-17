const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function start(port = Number(process.env.MOTAI_E2E_PORT || "5281")) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "motai-e2e-"));
  process.env.DATA_FILE = path.join(root, "db.json");
  process.env.ENV_FILE = path.join(root, ".env.local");
  process.env.MOTAI_TEST_AI = "1";
  process.env.PORT = String(port);

  const { createAppServer } = require("../server");
  const server = createAppServer();
  let closing;
  const close = () => closing ||= (async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
    await fs.rm(root, { recursive: true, force: true });
  })();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}

module.exports = { start };

if (require.main === module) {
  start(Number(process.env.PORT || process.env.MOTAI_E2E_PORT || "5281")).then((close) => {
    process.once("SIGINT", () => close().finally(() => process.exit(0)));
    process.once("SIGTERM", () => close().finally(() => process.exit(0)));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
