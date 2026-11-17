"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { bumpVersions, bumpWorkVersions, upgradeWork } = require("./workspace");
const { appError } = require("./errors");
const { DOCUMENT_COLLECTIONS, RECORD_COLLECTIONS, normalizeDatabase } = require("./storage");

// The Postgres backend of the storage layer. Same methods and the same
// behaviour as the JSON file store in src/storage.js; test/store-contract.test.js
// runs one suite against both.
//
// Concurrency: every write transaction first locks the single `storeRevision`
// row and moves it. Writes are therefore applied one at a time, exactly like
// the JSON file store, and two transactions can never wait on each other in
// a cycle. Reads take no locks. This is simple and correct for a beta; it
// limits write throughput to one transaction at a time and should be
// revisited before many people write at once.

const SCHEMA = "novel_studio";
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const KNOWN_KEYS = new Set(["schemaVersion", "storeRevision", "works", ...RECORD_COLLECTIONS, ...DOCUMENT_COLLECTIONS]);
const EXTRA_PREFIX = "extra:";

const clone = (value) => structuredClone(value);
const text = (value) => JSON.stringify(value);

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_[\w-]+\.sql$/.test(name))
    .sort()
    .map((name) => ({ version: Number(name.split("_")[0]), sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") }));
}

function recordsName(name) {
  if (!RECORD_COLLECTIONS.includes(name)) throw new TypeError(`Unknown record collection: ${name}`);
  return name;
}

function documentsName(name) {
  if (!DOCUMENT_COLLECTIONS.includes(name)) throw new TypeError(`Unknown document collection: ${name}`);
  return name;
}

function recordId(item, collection) {
  if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) {
    throw new TypeError(`Every ${collection} record needs a string id`);
  }
  return item.id;
}

// `pool` is a pg Pool or anything with the same `connect()` / `query()`.
// `createPool` is called on first use, so a server can be built before its
// database is reachable.
function createPostgresStore({ createPool }) {
  let pool;
  let ready;

  function getPool() {
    pool ||= createPool();
    return pool;
  }

  async function migrate() {
    const client = await getPool().connect();
    try {
      await client.query("begin");
      // One migrator at a time, even with several servers starting together.
      await client.query("select pg_advisory_xact_lock(hashtext('novel_studio:migrations'))");
      await client.query(`create schema if not exists ${SCHEMA}`);
      await client.query(`create table if not exists ${SCHEMA}.schema_migrations (version integer primary key, applied_at timestamptz not null default now())`);
      const { rows } = await client.query(`select version from ${SCHEMA}.schema_migrations`);
      const applied = new Set(rows.map((row) => row.version));
      for (const migration of migrationFiles()) {
        if (applied.has(migration.version)) continue;
        await client.query(migration.sql);
        await client.query(`insert into ${SCHEMA}.schema_migrations (version) values ($1)`, [migration.version]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  function ensureReady() {
    ready ||= migrate().catch((error) => { ready = null; throw error; });
    return ready;
  }

  async function query(sql, params) {
    await ensureReady();
    return getPool().query(sql, params);
  }

  // Runs `fn(client, storeRevision)` in a transaction that holds the store
  // revision lock, then moves the revision.
  async function writeTransaction(fn) {
    await ensureReady();
    const client = await getPool().connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(`select value from ${SCHEMA}.store_meta where key = 'storeRevision' for update`);
      const revision = Number(rows[0]?.value) || 0;
      const result = await fn(client, revision);
      await client.query(`update ${SCHEMA}.store_meta set value = $1::json where key = 'storeRevision'`, [text(revision + 1)]);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // ---- whole database -----------------------------------------------------

  async function loadAll(client) {
    const [meta, works, records, documents] = await Promise.all([
      client.query(`select key, value from ${SCHEMA}.store_meta`),
      client.query(`select data from ${SCHEMA}.works order by position, id`),
      client.query(`select collection, data from ${SCHEMA}.store_records order by collection, seq, id`),
      client.query(`select collection, key, data from ${SCHEMA}.store_documents order by collection, key`)
    ]);
    const database = {};
    for (const row of meta.rows) {
      if (row.key === "schemaVersion" || row.key === "storeRevision") database[row.key] = Number(row.value) || 0;
      else if (row.key.startsWith(EXTRA_PREFIX)) database[row.key.slice(EXTRA_PREFIX.length)] = row.value;
    }
    database.works = works.rows.map((row) => row.data);
    // Every collection is present, empty or not, as the file store has them
    // once the workspace defaults are set; otherwise each read would look
    // like data that still needs upgrading.
    for (const collection of RECORD_COLLECTIONS) database[collection] = [];
    for (const row of records.rows) (database[row.collection] ||= []).push(row.data);
    for (const row of documents.rows) (database[row.collection] ||= {})[row.key] = row.data;
    if (!database.settings) database.settings = { dailyTokenLimit: 200000 };
    return normalizeDatabase(database);
  }

  async function saveWorkRow(client, work, position) {
    const ownerId = typeof work.ownerId === "string" && work.ownerId ? work.ownerId : "local";
    await client.query(
      `insert into ${SCHEMA}.works (id, owner_id, row_version, position, data, updated_at) values ($1, $2, $3, $4, $5::json, now())
       on conflict (id) do update set owner_id = excluded.owner_id, row_version = excluded.row_version, position = excluded.position, data = excluded.data, updated_at = now()`,
      [work.id, ownerId, Number.isInteger(work.rowVersion) ? work.rowVersion : 1, position, text(work)]
    );
  }

  async function saveRecords(client, collection, before, after) {
    const previous = new Map(before.map((item, index) => [recordId(item, collection), { index, data: text(item) }]));
    const seen = new Set();
    for (const [index, item] of after.entries()) {
      const id = recordId(item, collection);
      if (seen.has(id)) throw new TypeError(`Duplicate ${collection} record id: ${id}`);
      seen.add(id);
      const old = previous.get(id);
      if (old && old.index === index && old.data === text(item)) continue;
      await client.query(
        `insert into ${SCHEMA}.store_records (collection, id, seq, data) values ($1, $2, $3, $4::json)
         on conflict (collection, id) do update set seq = excluded.seq, data = excluded.data`,
        [collection, id, index, text(item)]
      );
    }
    const removed = [...previous.keys()].filter((id) => !seen.has(id));
    if (removed.length) await client.query(`delete from ${SCHEMA}.store_records where collection = $1 and id = any($2::text[])`, [collection, removed]);
  }

  async function saveDocuments(client, collection, before, after) {
    const previous = before && typeof before === "object" ? before : {};
    const next = after && typeof after === "object" ? after : {};
    for (const [key, value] of Object.entries(next)) {
      if (Object.hasOwn(previous, key) && text(previous[key]) === text(value)) continue;
      await client.query(
        `insert into ${SCHEMA}.store_documents (collection, key, data) values ($1, $2, $3::json)
         on conflict (collection, key) do update set data = excluded.data`,
        [collection, key, text(value === undefined ? null : value)]
      );
    }
    const removed = Object.keys(previous).filter((key) => !Object.hasOwn(next, key));
    if (removed.length) await client.query(`delete from ${SCHEMA}.store_documents where collection = $1 and key = any($2::text[])`, [collection, removed]);
  }

  // Writes the difference between two whole databases.
  async function saveAll(client, before, after) {
    const previousWorks = new Map(before.works.map((work, index) => [work.id, { index, data: text(work) }]));
    const ids = new Set();
    for (const [index, work] of after.works.entries()) {
      ids.add(work.id);
      const old = previousWorks.get(work.id);
      if (old && old.index === index && old.data === text(work)) continue;
      await saveWorkRow(client, work, index);
    }
    const removed = [...previousWorks.keys()].filter((id) => !ids.has(id));
    if (removed.length) await client.query(`delete from ${SCHEMA}.works where id = any($1::text[])`, [removed]);
    for (const collection of RECORD_COLLECTIONS) {
      await saveRecords(client, collection, Array.isArray(before[collection]) ? before[collection] : [], Array.isArray(after[collection]) ? after[collection] : []);
    }
    for (const collection of DOCUMENT_COLLECTIONS) await saveDocuments(client, collection, before[collection], after[collection]);
    await client.query(`update ${SCHEMA}.store_meta set value = $1::json where key = 'schemaVersion'`, [text(after.schemaVersion)]);
    const extraKeys = new Set([...Object.keys(before), ...Object.keys(after)].filter((key) => !KNOWN_KEYS.has(key)));
    for (const key of extraKeys) {
      if (after[key] === undefined) await client.query(`delete from ${SCHEMA}.store_meta where key = $1`, [EXTRA_PREFIX + key]);
      else if (text(before[key]) !== text(after[key])) {
        await client.query(
          `insert into ${SCHEMA}.store_meta (key, value) values ($1, $2::json) on conflict (key) do update set value = excluded.value`,
          [EXTRA_PREFIX + key, text(after[key])]
        );
      }
    }
  }

  async function read() {
    await ensureReady();
    const client = await getPool().connect();
    try {
      // One snapshot, so the parts read together are consistent.
      await client.query("begin isolation level repeatable read read only");
      const database = await loadAll(client);
      await client.query("commit");
      return database;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  function write(value) {
    const snapshot = JSON.parse(JSON.stringify(normalizeDatabase(value)));
    return writeTransaction(async (client, revision) => {
      if (snapshot.storeRevision !== undefined && snapshot.storeRevision !== revision) throw appError("STORE_REVISION_CONFLICT");
      const previous = await loadAll(client);
      if (snapshot.schemaVersion >= 3) bumpVersions(previous, snapshot);
      await saveAll(client, previous, snapshot);
      snapshot.storeRevision = revision + 1;
      return snapshot;
    });
  }

  function transact(mutator) {
    if (typeof mutator !== "function") throw new TypeError("transact requires a mutator function");
    return writeTransaction(async (client, revision) => {
      const database = await loadAll(client);
      const previous = clone(database);
      const result = await mutator(database);
      if (database.schemaVersion >= 3) bumpVersions(previous, database);
      await saveAll(client, previous, database);
      database.storeRevision = revision + 1;
      return result;
    });
  }

  // ---- stories --------------------------------------------------------------

  async function listWorks(ownerId) {
    const { rows } = await query(`select data from ${SCHEMA}.works where owner_id = $1 order by position, id`, [ownerId]);
    return rows.map((row) => row.data);
  }

  async function getWork(workId) {
    const { rows } = await query(`select data from ${SCHEMA}.works where id = $1`, [workId]);
    return rows[0]?.data ?? null;
  }

  async function schemaVersionOf(client) {
    const { rows } = await client.query(`select value from ${SCHEMA}.store_meta where key = 'schemaVersion'`);
    return Number(rows[0]?.value) || 0;
  }

  function transactWork(workId, mutator) {
    if (typeof mutator !== "function") throw new TypeError("transactWork requires a mutator function");
    return writeTransaction(async (client) => {
      const { rows } = await client.query(`select position, data from ${SCHEMA}.works where id = $1`, [workId]);
      if (!rows.length) throw appError("WORK_NOT_FOUND");
      const work = rows[0].data;
      const previous = clone(work);
      const result = await mutator(work);
      if (await schemaVersionOf(client) >= 3) { upgradeWork(work); bumpWorkVersions(previous, work); }
      if (text(previous) !== text(work)) await saveWorkRow(client, work, Number(rows[0].position));
      return result;
    });
  }

  function saveWorks({ upserts = [], removals = [] } = {}) {
    return writeTransaction(async (client) => {
      const ids = [...upserts.map(({ work }) => work.id), ...removals.map(({ id }) => id)];
      const { rows } = await client.query(`select id, position, data from ${SCHEMA}.works where id = any($1::text[])`, [ids]);
      const stored = new Map(rows.map((row) => [row.id, row]));
      const versionOf = (id) => stored.get(id)?.data?.rowVersion ?? null;
      for (const { work, expectedVersion } of upserts) {
        if (versionOf(work.id) !== (expectedVersion ?? null)) throw appError("WORK_UPDATED_ELSEWHERE");
      }
      for (const { id, expectedVersion } of removals) {
        if (versionOf(id) !== (expectedVersion ?? null)) throw appError("WORK_UPDATED_ELSEWHERE");
      }
      if (removals.length) await client.query(`delete from ${SCHEMA}.works where id = any($1::text[])`, [removals.map(({ id }) => id)]);
      const versioned = await schemaVersionOf(client) >= 3;
      const { rows: first } = await client.query(`select min(position) as position from ${SCHEMA}.works`);
      let nextFront = (first[0]?.position === null || first[0]?.position === undefined ? 0 : Number(first[0].position)) - 1;
      for (const { work } of upserts) {
        const old = stored.get(work.id);
        if (versioned) {
          upgradeWork(work);
          if (old) bumpWorkVersions(old.data, work);
        }
        // New stories go first, as in the file store.
        await saveWorkRow(client, work, old ? Number(old.position) : nextFront--);
      }
      return upserts.map(({ work }) => work);
    });
  }

  // ---- records and documents -------------------------------------------------

  async function readRecords(name) {
    const { rows } = await query(`select data from ${SCHEMA}.store_records where collection = $1 order by seq, id`, [recordsName(name)]);
    return rows.map((row) => row.data);
  }

  function transactRecords(name, mutator) {
    recordsName(name);
    if (typeof mutator !== "function") throw new TypeError("transactRecords requires a mutator function");
    return writeTransaction(async (client) => {
      const { rows } = await client.query(`select data from ${SCHEMA}.store_records where collection = $1 order by seq, id`, [name]);
      const records = rows.map((row) => row.data);
      const before = clone(records);
      const result = await mutator(records);
      await saveRecords(client, name, before, records);
      return result;
    });
  }

  async function readDocument(name, key) {
    const { rows } = await query(`select data from ${SCHEMA}.store_documents where collection = $1 and key = $2`, [documentsName(name), key]);
    return rows[0]?.data ?? null;
  }

  function transactDocument(name, key, mutator) {
    documentsName(name);
    if (typeof mutator !== "function") throw new TypeError("transactDocument requires a mutator function");
    return writeTransaction(async (client) => {
      const { rows } = await client.query(`select data from ${SCHEMA}.store_documents where collection = $1 and key = $2`, [name, key]);
      const next = await mutator(rows[0]?.data ?? null);
      await client.query(
        `insert into ${SCHEMA}.store_documents (collection, key, data) values ($1, $2, $3::json)
         on conflict (collection, key) do update set data = excluded.data`,
        [name, key, text(next === undefined ? null : next)]
      );
      return next;
    });
  }

  async function close() {
    if (pool) await pool.end();
    pool = null;
    ready = null;
  }

  return {
    backend: "postgres",
    ready: ensureReady,
    close,
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

// TLS for a remote database. DATABASE_SSL: "verify" (default), "no-verify"
// (encrypted, certificate not checked), or "off" (local servers only).
// DATABASE_CA_FILE: a certificate file to trust, such as the one Supabase
// offers for download in its database settings.
function sslOptions(env, host) {
  const mode = env.DATABASE_SSL || (["localhost", "127.0.0.1", "::1"].includes(host) ? "off" : "verify");
  if (mode === "off") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  const ca = env.DATABASE_CA_FILE ? fs.readFileSync(env.DATABASE_CA_FILE, "utf8") : undefined;
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

// A pg Pool from environment settings. Never logs the connection string.
function poolFromEnvironment(env = process.env) {
  const connectionString = String(env.DATABASE_URL || "").trim();
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  let host;
  try { host = new URL(connectionString).hostname; } catch { throw new Error("DATABASE_URL is not a valid URL"); }
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString,
    ssl: sslOptions(env, host),
    max: Math.max(1, Math.min(20, Number(env.DATABASE_POOL_SIZE) || 5)),
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000
  });
  // An idle connection that the server drops (restart, network) must not take
  // the whole process down; the next query opens a new one.
  pool.on("error", (error) => {
    console.error(`Database connection lost: ${error.code || error.message}`);
  });
  return pool;
}

module.exports = { createPostgresStore, poolFromEnvironment, sslOptions };
