const fsp = require("fs/promises");
const path = require("path");
const { bumpVersions } = require("./workspace");
const { appError } = require("./errors");

function normalizeDatabase(value) {
  return {
    ...value,
    schemaVersion: Number.isInteger(value?.schemaVersion) && value.schemaVersion >= 0
      ? value.schemaVersion
      : 0,
    works: Array.isArray(value?.works) ? value.works : []
  };
}

// On Windows, replacing a file that another handle is reading at that moment
// fails with EPERM/EACCES/EBUSY. The lock is momentary, so retry briefly.
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

async function renameWithRetry(from, to, attempts = 8) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fsp.rename(from, to);
    } catch (error) {
      if (!TRANSIENT_RENAME_CODES.has(error.code) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}

const RECORD_COLLECTIONS = Object.freeze(["tasks", "usage", "imports", "receipts"]);
const DOCUMENT_COLLECTIONS = Object.freeze(["settings", "userPreferences"]);

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
      await renameWithRetry(tempFile, resolvedFile);
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
        throw appError("STORE_REVISION_CONFLICT");
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

  // Story-by-story access. New code uses these instead of `read` / `transact`,
  // which hand over the whole database: a database backend can implement
  // these three as single-row operations.

  // The stories that belong to one user. Stories saved before ownership
  // existed belong to the local user.
  async function listWorks(ownerId) {
    const database = await read();
    return database.works.filter((work) => (work.ownerId || "local") === ownerId);
  }

  async function getWork(workId) {
    const database = await read();
    return database.works.find((work) => work.id === workId) || null;
  }

  // Atomic read-modify-write of one story. `mutator(work)` changes the story
  // in place; whatever it returns is the result. Throwing changes nothing.
  function transactWork(workId, mutator) {
    if (typeof mutator !== "function") {
      throw new TypeError("transactWork requires a mutator function");
    }
    return transact((database) => {
      const work = database.works.find((candidate) => candidate.id === workId);
      if (!work) throw appError("WORK_NOT_FOUND");
      return mutator(work);
    });
  }

  // Data that is not part of a story. Records are lists of objects with an
  // `id` (tasks, usage entries, import previews); documents are single values
  // found by a key (a user's preferences, a setting). A database backend
  // keeps each of these in its own table.
  function recordsName(name) {
    if (!RECORD_COLLECTIONS.includes(name)) throw new TypeError(`Unknown record collection: ${name}`);
    return name;
  }
  function documentsName(name) {
    if (!DOCUMENT_COLLECTIONS.includes(name)) throw new TypeError(`Unknown document collection: ${name}`);
    return name;
  }

  async function readRecords(name) {
    const database = await read();
    return Array.isArray(database[recordsName(name)]) ? database[name] : [];
  }

  // Atomic change of one collection. `mutator(records)` changes the list in
  // place; whatever it returns is the result.
  function transactRecords(name, mutator) {
    recordsName(name);
    return transact((database) => {
      if (!Array.isArray(database[name])) database[name] = [];
      return mutator(database[name]);
    });
  }

  async function readDocument(name, key) {
    const database = await read();
    return database[documentsName(name)]?.[key] ?? null;
  }

  // Atomic change of one document. `mutator(current)` gets the stored value
  // (null when there is none) and returns the value to store.
  function transactDocument(name, key, mutator) {
    documentsName(name);
    return transact(async (database) => {
      if (!database[name] || typeof database[name] !== "object") database[name] = {};
      const next = await mutator(database[name][key] ?? null);
      database[name][key] = next;
      return next;
    });
  }

  // Saves whole stories that were read earlier and changed in memory. Each
  // entry names the rowVersion it was read at (null for a new story); if any
  // of them has moved since, nothing is saved.
  function saveWorks({ upserts = [], removals = [] } = {}) {
    return transact((database) => {
      const storedVersion = (workId) => database.works.find((work) => work.id === workId)?.rowVersion ?? null;
      for (const { work, expectedVersion } of upserts) {
        if (storedVersion(work.id) !== (expectedVersion ?? null)) throw appError("WORK_UPDATED_ELSEWHERE");
      }
      for (const { id, expectedVersion } of removals) {
        if (storedVersion(id) !== (expectedVersion ?? null)) throw appError("WORK_UPDATED_ELSEWHERE");
      }
      database.works = database.works.filter((work) => !removals.some((removal) => removal.id === work.id));
      for (const { work } of upserts) {
        const index = database.works.findIndex((candidate) => candidate.id === work.id);
        if (index < 0) database.works.unshift(work);
        else database.works[index] = work;
      }
      // The same objects, which carry their new revisions once the
      // transaction has ended.
      return upserts.map(({ work }) => work);
    });
  }

  return {
    filePath: resolvedFile,
    read,
    write,
    transact,
    listWorks,
    getWork,
    transactWork,
    saveWorks,
    readRecords,
    transactRecords,
    readDocument,
    transactDocument
  };
}

module.exports = {
  DOCUMENT_COLLECTIONS,
  RECORD_COLLECTIONS,
  createJsonStore,
  normalizeDatabase
};
