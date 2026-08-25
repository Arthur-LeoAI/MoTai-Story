const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

async function start() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "motai-e2e-"));
  process.env.DATA_FILE = path.join(root, "db.json");
  process.env.ENV_FILE = path.join(root, ".env.local");
  process.env.AI_PROVIDER = "local";
  process.env.PORT = process.env.PORT || "5281";

  const { createAppServer } = require("../server");
  const server = createAppServer();
  const close = async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  };

  process.once("SIGINT", () => close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => close().finally(() => process.exit(0)));
  server.listen(Number(process.env.PORT), "127.0.0.1");
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
