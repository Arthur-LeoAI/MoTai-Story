// Checks that the database in DATABASE_URL can be reached, without changing
// anything in it and without ever printing the connection string or password.
//
//   node --env-file=path/to/.env.local scripts/check-database.cjs
//
// Settings read: DATABASE_URL, DATABASE_SSL (verify | no-verify | off),
// DATABASE_CA_FILE. See docs/FOUNDATION.md, "Database".
const { poolFromEnvironment, sslOptions } = require("../src/postgres-store");

function scrub(message) {
  return String(message || "").replace(/postgres(ql)?:\/\/\S+/gi, "[connection string]");
}

function describeHost(raw) {
  try {
    const url = new URL(raw.trim());
    const kind = url.hostname.endsWith(".pooler.supabase.com") ? "Supabase pooler"
      : url.hostname.endsWith(".supabase.co") ? "Supabase direct connection"
        : ["localhost", "127.0.0.1", "::1"].includes(url.hostname) ? "this computer" : "another server";
    return `${kind}, port ${url.port || "5432"}`;
  } catch {
    return null;
  }
}

const HINTS = {
  "28P01": "The password was refused. Check that [YOUR-PASSWORD] was replaced, and reset the database password in the Supabase dashboard if needed.",
  "3D000": "The database name in the connection string does not exist.",
  ENOTFOUND: "The host name was not found. Copy the connection string again, or check the network.",
  ETIMEDOUT: "No answer from the server. Use the Session pooler string (the direct connection needs IPv6), or check a firewall or VPN.",
  ECONNREFUSED: "The server refused the connection. Check the port in the connection string.",
  SELF_SIGNED_CERT_IN_CHAIN: "The server's certificate is not trusted yet. Download the SSL certificate from the Supabase database settings and set DATABASE_CA_FILE to its path, or set DATABASE_SSL=no-verify for a first test.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The server's certificate could not be checked. Set DATABASE_CA_FILE to the certificate from the Supabase database settings."
};

(async () => {
  const raw = process.env.DATABASE_URL || "";
  if (!raw.trim()) {
    console.log("DATABASE_URL is not set. Pass the env file with --env-file=…");
    process.exitCode = 1;
    return;
  }
  const host = describeHost(raw);
  if (!host) {
    console.log("DATABASE_URL is set but is not a valid URL. Special characters in the password (such as @ # / ?) must be percent-encoded.");
    process.exitCode = 1;
    return;
  }
  if (/\[?YOUR-PASSWORD\]?/i.test(raw)) {
    console.log("DATABASE_URL still contains the [YOUR-PASSWORD] placeholder.");
    process.exitCode = 1;
    return;
  }
  const ssl = sslOptions(process.env, new URL(raw.trim()).hostname);
  console.log(`Connecting to ${host}, TLS: ${ssl === false ? "off" : ssl.rejectUnauthorized ? "on, certificate checked" : "on, certificate not checked"} …`);
  const pool = poolFromEnvironment(process.env);
  try {
    const { rows } = await pool.query("select split_part(version(), ' ', 2) as version, current_database() as database");
    const schema = await pool.query("select exists (select 1 from information_schema.schemata where schema_name = 'novel_studio') as present");
    console.log(`Connected. PostgreSQL ${rows[0].version}, database "${rows[0].database}".`);
    console.log(schema.rows[0].present
      ? "The application's tables exist (schema novel_studio)."
      : "The application's tables do not exist yet; they are created the first time the app starts with NOVEL_STUDIO_STORAGE=postgres.");
  } catch (error) {
    console.log(`Could not connect: ${error.code || ""} ${scrub(error.message)}`.trim());
    const hint = HINTS[error.code];
    if (hint) console.log(hint);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
