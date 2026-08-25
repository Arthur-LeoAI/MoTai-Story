const fsp = require("fs/promises");
const path = require("path");

function normalizeDatabase(value) {
  return {
    works: Array.isArray(value?.works) ? value.works : []
  };
}

function createJsonStore(filePath) {
  const resolvedFile = path.resolve(filePath);
  let writeTail = Promise.resolve();

  async function read() {
    await writeTail;
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

  function write(value) {
    const payload = `${JSON.stringify(normalizeDatabase(value), null, 2)}\n`;
    const operation = writeTail.then(async () => {
      await fsp.mkdir(path.dirname(resolvedFile), { recursive: true });
      const tempFile = `${resolvedFile}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fsp.writeFile(tempFile, payload, "utf8");
        await fsp.rename(tempFile, resolvedFile);
      } finally {
        await fsp.unlink(tempFile).catch(() => {});
      }
    });

    writeTail = operation.catch(() => {});
    return operation;
  }

  return {
    filePath: resolvedFile,
    read,
    write
  };
}

module.exports = {
  createJsonStore,
  normalizeDatabase
};
