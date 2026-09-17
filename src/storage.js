const fsp = require("fs/promises");
const path = require("path");
const { bumpVersions } = require("./workspace");

function normalizeDatabase(value) {
  return {
    ...value,
    schemaVersion: Number.isInteger(value?.schemaVersion) && value.schemaVersion >= 0
      ? value.schemaVersion
      : 0,
    works: Array.isArray(value?.works) ? value.works : []
  };
}

function createJsonStore(filePath) {
  const resolvedFile = path.resolve(filePath);
  let writeTail = Promise.resolve();

  async function readFile() {
    try {
      const raw = await fsp.readFile(resolvedFile, "utf8");
      return normalizeDatabase(JSON.parse(raw));
    } catch (error) {
      if (error.code === "ENOENT") {
        return normalizeDatabase();
      }
      throw error;
    }
  }

  async function writeFile(value) {
    const payload = `${JSON.stringify(normalizeDatabase(value), null, 2)}\n`;
    await fsp.mkdir(path.dirname(resolvedFile), { recursive: true });
    const tempFile = `${resolvedFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fsp.writeFile(tempFile, payload, "utf8");
      await fsp.rename(tempFile, resolvedFile);
    } finally {
      await fsp.unlink(tempFile).catch(() => {});
    }
  }

  async function read() {
    await writeTail;
    return readFile();
  }

  function write(value) {
    const snapshot = JSON.parse(JSON.stringify(normalizeDatabase(value)));
    const operation = writeTail.then(async () => {
      const previous = await readFile();
      if (snapshot.storeRevision !== undefined && snapshot.storeRevision !== (previous.storeRevision || 0)) {
        throw Object.assign(new Error("数据已更新，请刷新后重试；未保存的编辑仍保留。"), { status: 409 });
      }
      if (snapshot.schemaVersion >= 3) bumpVersions(previous, snapshot);
      snapshot.storeRevision = (previous.storeRevision || 0) + 1;
      await writeFile(snapshot);
      return snapshot;
    });

    writeTail = operation.catch(() => {});
    return operation;
  }

  function transact(mutator) {
    if (typeof mutator !== "function") {
      throw new TypeError("transact requires a mutator function");
    }

    const operation = writeTail.then(async () => {
      const database = await readFile();
      const previous = structuredClone(database);
      const result = await mutator(database);
      if (database.schemaVersion >= 3) bumpVersions(previous, database);
      database.storeRevision = (previous.storeRevision || 0) + 1;
      await writeFile(database);
      return result;
    });

    writeTail = operation.catch(() => {});
    return operation;
  }

  return {
    filePath: resolvedFile,
    read,
    write,
    transact
  };
}

module.exports = {
  createJsonStore,
  normalizeDatabase
};
