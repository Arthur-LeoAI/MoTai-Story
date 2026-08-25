const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

function getDesktopDataPaths(userDataDir) {
  const root = path.resolve(userDataDir);
  const dataDir = path.join(root, "data");
  return {
    root,
    dataDir,
    dbFile: path.join(dataDir, "db.json"),
    coversDir: path.join(dataDir, "covers"),
    envFile: path.join(root, ".env.local"),
    migrationFile: path.join(root, "migration.json")
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDesktopDataDirectories(paths) {
  await fs.mkdir(paths.dataDir, { recursive: true });
  await fs.mkdir(paths.coversDir, { recursive: true });
}

async function copyFileIfMissing(source, destination) {
  if (!(await pathExists(source)) || (await pathExists(destination))) {
    return false;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination, fsSync.constants.COPYFILE_EXCL);
  return true;
}

async function copyDirectoryIfMissing(source, destination) {
  if (!(await pathExists(source))) {
    return false;
  }
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: false });
  return true;
}

async function validateDatabaseFile(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(source);
  if (!parsed || !Array.isArray(parsed.works)) {
    throw new Error("旧数据库格式不正确，缺少 works 列表。");
  }
}

function getLegacyRoot(dbFile, explicitRoot) {
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  return path.resolve(path.dirname(dbFile), "..");
}

async function migrateLegacyData({ paths, legacyRoot, legacyDbFile } = {}) {
  if (!paths) {
    throw new Error("缺少桌面数据目录。");
  }
  await ensureDesktopDataDirectories(paths);

  if (await pathExists(paths.dbFile)) {
    return { migrated: false, reason: "destination-exists" };
  }

  const sourceDbFile = legacyDbFile
    ? path.resolve(legacyDbFile)
    : legacyRoot
      ? path.join(path.resolve(legacyRoot), "data", "db.json")
      : "";
  if (!sourceDbFile || !(await pathExists(sourceDbFile))) {
    return { migrated: false, reason: "source-missing" };
  }

  await validateDatabaseFile(sourceDbFile);
  const sourceRoot = getLegacyRoot(sourceDbFile, legacyRoot);
  await copyFileIfMissing(sourceDbFile, paths.dbFile);
  await copyDirectoryIfMissing(path.join(path.dirname(sourceDbFile), "covers"), paths.coversDir);
  await copyFileIfMissing(path.join(sourceRoot, ".env.local"), paths.envFile);

  return { migrated: true, sourceDbFile };
}

async function saveMigrationState(paths, state) {
  await fs.mkdir(paths.root, { recursive: true });
  await fs.writeFile(
    paths.migrationFile,
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

async function hasMigrationState(paths) {
  return pathExists(paths.migrationFile);
}

module.exports = {
  getDesktopDataPaths,
  pathExists,
  ensureDesktopDataDirectories,
  migrateLegacyData,
  saveMigrationState,
  hasMigrationState
};
