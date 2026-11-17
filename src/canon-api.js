"use strict";

// HTTP routes for the structured story objects (data model v6).
//
//   GET    /api/works/:workId/canon                       all objects + canonRevision
//   POST   /api/works/:workId/canon/:collection           create
//   PATCH  /api/works/:workId/canon/:collection/:itemId   change (body.baseRevision = the object's revision)
//   DELETE /api/works/:workId/canon/:collection/:itemId   remove (body.baseRevision)
//
// :collection is one of entities, relations, events, threads, setups.
// Facts keep their own routes (fact proposals, POST /api/works/:id/facts).
function createCanonApi({ repository, readDb, readBody, sendJson }) {
  return async function handle(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api" || parts[1] !== "works" || !parts[2] || parts[3] !== "canon" || parts.length > 6) return false;
    const [, , workId, , collection, itemId] = parts;
    // Makes sure the stored data has been upgraded before a transaction reads it.
    await readDb();

    if (parts.length === 4 && req.method === "GET") {
      sendJson(res, 200, { canon: await repository.read(workId, req.user) });
      return true;
    }
    if (parts.length === 5 && req.method === "POST") {
      sendJson(res, 201, await repository.create(workId, req.user, collection, await readBody(req, 256 * 1024)));
      return true;
    }
    if (parts.length === 6 && req.method === "PATCH") {
      sendJson(res, 200, await repository.update(workId, req.user, collection, itemId, await readBody(req, 256 * 1024)));
      return true;
    }
    if (parts.length === 6 && req.method === "DELETE") {
      sendJson(res, 200, await repository.remove(workId, req.user, collection, itemId, await readBody(req, 16 * 1024)));
      return true;
    }
    return false;
  };
}

module.exports = { createCanonApi };
