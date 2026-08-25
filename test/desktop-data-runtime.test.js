const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { getDesktopDataPaths, migrateLegacyData } = require("../desktop/data-runtime.cjs");

test("桌面版会迁移旧数据库、封面和 API 配置，且不会覆盖已有数据", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "motai-desktop-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const legacyRoot = path.join(root, "legacy");
  const appDataRoot = path.join(root, "app-data");
  await fs.mkdir(path.join(legacyRoot, "data", "covers"), { recursive: true });
  await fs.writeFile(path.join(legacyRoot, "data", "db.json"), '{"works":[]}', "utf8");
  await fs.writeFile(path.join(legacyRoot, "data", "covers", "cover.png"), "cover", "utf8");
  await fs.writeFile(path.join(legacyRoot, ".env.local"), "OPENAI_API_KEY=private-key\n", "utf8");

  const paths = getDesktopDataPaths(appDataRoot);
  const result = await migrateLegacyData({ paths, legacyRoot });
  assert.equal(result.migrated, true);
  assert.equal(await fs.readFile(paths.dbFile, "utf8"), '{"works":[]}');
  assert.equal(await fs.readFile(path.join(paths.coversDir, "cover.png"), "utf8"), "cover");
  assert.match(await fs.readFile(paths.envFile, "utf8"), /private-key/);

  await fs.writeFile(paths.dbFile, '{"works":["keep"]}', "utf8");
  const secondResult = await migrateLegacyData({ paths, legacyRoot });
  assert.equal(secondResult.reason, "destination-exists");
  assert.equal(await fs.readFile(paths.dbFile, "utf8"), '{"works":["keep"]}');
});
