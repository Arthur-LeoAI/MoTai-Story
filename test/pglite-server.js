// An in-process PostgreSQL (PGlite) reachable over a local socket, so tests can
// use the real `pg` driver and the real SQL of src/postgres-store.js without an
// external database. Every call starts an empty database.
const { PGlite } = require("@electric-sql/pglite");
const { PGLiteSocketServer } = require("@electric-sql/pglite-socket");

async function startPostgres() {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 20 });
  await server.start();
  const port = Number(String(server.getServerConn()).split(":").pop());
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
    async stop() {
      await server.stop();
      await db.close();
    }
  };
}

module.exports = { startPostgres };
