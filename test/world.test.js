const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "world-"));
process.env.DATA_FILE = path.join(dir, "db.json");
process.env.ENV_FILE = path.join(dir, ".env");
process.env.MOTAI_TEST_AI = "1";

const world = require("../src/world");
const { deriveCanonFacts } = require("../src/canon-model");
const { normalizeCanon } = require("../src/continuity");
const { createAppServer } = require("../server");

const server = createAppServer();
let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(dir, { recursive: true, force: true });
});

async function call(url, method = "GET", data) {
  const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const text = await response.text();
  return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : text };
}

test("the world in a sentence reads as empty, and is saved against the revision it was read at", () => {
  assert.deepEqual(world.normalizeWorld(undefined), { what: "", here: "", revision: 0, updatedAt: "" });
  const work = { world: { what: "drowned", revision: 1 } };
  assert.throws(() => world.updateWorld(work, { lines: { here: "x" }, baseRevision: 0 }, "t"), { code: "REVISION_CONFLICT" });
  assert.throws(() => world.updateWorld(work, { baseRevision: 1 }, "t"), { code: "BAD_REQUEST" });
  const saved = world.updateWorld(work, { lines: { here: "  names   are   power " }, baseRevision: 1 }, "2026-11-18T00:00:00.000Z");
  assert.deepEqual(saved, { what: "drowned", here: "names are power", revision: 2, updatedAt: "2026-11-18T00:00:00.000Z" });
});

test("a rule that is only its statement is still a hard world rule for the writing", () => {
  const work = { language: "en", chapters: [], canon: normalizeCanon({ entities: [
    { id: "r1", type: "rule", name: "Speaking a true name gives power over its bearer" },
    { id: "r2", type: "rule", name: "The tide never turns at night", card: { cost: "Ships wait in harbour" } },
    { id: "p1", type: "location", name: "Vell" }
  ] }) };
  const facts = deriveCanonFacts(work);
  assert.deepEqual(facts.map((fact) => [fact.subjectId, fact.category, fact.strength, fact.value]), [
    ["r1", "world_rule", "hard", "Speaking a true name gives power over its bearer"],
    ["r2", "world_rule", "hard", "Cost or limit: Ships wait in harbour"]
  ]);
});

test("HTTP: the world in a sentence is saved on the story, and a stale save is refused", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "World", language: "en", focus: "shape" });
  assert.equal((await call(`/api/works/${work.id}/world`)).body.world.revision, 0);
  const saved = await call(`/api/works/${work.id}/world`, "PUT", { lines: { what: "where the sea has swallowed the old roads", here: "maps are worth more than gold" }, baseRevision: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.world.revision, 1);
  const stale = await call(`/api/works/${work.id}/world`, "PUT", { lines: { what: "other" }, baseRevision: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "REVISION_CONFLICT");
  assert.equal((await call(`/api/works/${work.id}/world`)).body.world.here, "maps are worth more than gold");
});

test("HTTP: places sit inside places, never inside themselves, and move up when their parent goes", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Places", language: "en", focus: "shape" });
  const place = async (data) => call(`/api/works/${work.id}/canon/entities`, "POST", { type: "location", ...data });
  const coast = (await place({ name: "The Drowned Coast" })).body.item;
  const vell = (await place({ name: "Vell", parentId: coast.id })).body.item;
  const archive = (await place({ name: "The Archive", parentId: vell.id })).body.item;
  assert.equal(vell.parentId, coast.id);

  // A missing parent, a parent that is not a place, and a loop are refused.
  assert.equal((await place({ name: "Nowhere", parentId: "missing" })).body.error.code, "CANON_REFERENCE_NOT_FOUND");
  const mira = (await call(`/api/works/${work.id}/canon/entities`, "POST", { type: "character", name: "Mira" })).body.item;
  assert.equal((await place({ name: "Inside Mira", parentId: mira.id })).body.error.code, "CANON_REFERENCE_NOT_FOUND");
  const loop = await call(`/api/works/${work.id}/canon/entities/${coast.id}`, "PATCH", { parentId: archive.id, baseRevision: coast.revision });
  assert.equal(loop.status, 400);
  assert.equal(loop.body.error.code, "CANON_PLACE_CYCLE");
  const self = await call(`/api/works/${work.id}/canon/entities/${vell.id}`, "PATCH", { parentId: vell.id, baseRevision: vell.revision });
  assert.equal(self.body.error.code, "CANON_PLACE_CYCLE");

  // The writing knows where a place is.
  const facts = deriveCanonFacts({ language: "en", chapters: [], canon: (await call(`/api/works/${work.id}/canon`)).body.canon });
  assert.equal(facts.find((fact) => fact.subjectId === archive.id).value, "Part of: Vell");

  // Deleting Vell moves the Archive up to the coast.
  await call(`/api/works/${work.id}/canon/entities/${vell.id}`, "DELETE", { baseRevision: vell.revision });
  const after = (await call(`/api/works/${work.id}/canon`)).body.canon.entities.find((entity) => entity.id === archive.id);
  assert.equal(after.parentId, coast.id);
  assert.equal(after.revision, archive.revision + 1);
});

test("HTTP: a stance between two factions is a relation of kind ally or enemy", async () => {
  const { body: { work } } = await call("/api/works", "POST", { title: "Factions", language: "en", focus: "shape" });
  const faction = async (name) => (await call(`/api/works/${work.id}/canon/entities`, "POST", { type: "faction", name, card: { want: "The coast", fear: "A map they did not draw" } })).body.item;
  const wardens = await faction("The Governor's Wardens");
  const guild = await faction("The Smugglers' Guild");
  assert.equal(wardens.parentId, "");
  const stance = await call(`/api/works/${work.id}/canon/relations`, "POST", { fromId: wardens.id, toId: guild.id, kind: "enemy" });
  assert.equal(stance.status, 201);
  const facts = deriveCanonFacts({ language: "en", chapters: [], canon: (await call(`/api/works/${work.id}/canon`)).body.canon });
  assert.ok(facts.some((fact) => fact.category === "relationship" && fact.subjectId === wardens.id && fact.objectId === guild.id && fact.value === "enemies"));
});
