#!/usr/bin/env bun
// Hasna Notes self-hosted server — entrypoint.
// Zero-ops run: `bun server/index.mjs` (repo) or `bunx notes-server`.
// Two backends, one wire dialect (personalnotes/v1):
//   HASNA_NOTES_DATABASE_URL present -> PostgreSQL
//   absent                          -> SQLite (default resolved via
//                                        @hasna/paths: legacy ~/.hasna/notes/
//                                        server.db until the XDG data home is
//                                        adopted; a legacy
//                                        ~/.hasna/apps/notes-server/server.db
//                                        is copied forward once)
// The DSN is never logged. The PostgreSQL schema is applied by
// scripts/apply-postgres-migrations.mjs (owner role) before first run.
// Flags: --port <n> --host [addr] --db <path> --auto-approve --dev
// Env:   HASNA_NOTES_SERVER_PORT|PORT, HASNA_NOTES_SERVER_HOST,
//        HASNA_NOTES_SERVER_DB, HASNA_NOTES_SERVER_URL,
//        HASNA_NOTES_SERVER_AUTO_APPROVE=1, HASNA_NOTES_SERVER_DEV=1,
//        HASNA_NOTES_SERVER_JWT_SECRET,
//        HASNA_NOTES_DATABASE_URL (selects the postgresql backend),
//        HASNA_NOTES_API_SIGNING_KEY (postgresql backend api-key auth;
//        fallbacks API_KEY_SIGNING_SECRET, HASNA_API_SIGNING_KEY)

import { openStorage } from './storage.mjs';
import { createApp, resolveConfig, SERVICE, VERSION } from './app.mjs';
import { DEFAULT_DB_PATH, LEGACY_DB_PATH, migrateLegacyServerDb } from './paths.mjs';

// Binds-before-version class (todos row 7e5f8f3d): --version must answer
// BEFORE resolveConfig()/Bun.serve. It previously fell through and bound the
// listener (:8788) with no output.
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  console.log(VERSION);
  process.exit(0);
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`${SERVICE} v${VERSION} — self-hosted Hasna Notes server (personalnotes/v1 dialect)

Usage: notes-serve [--port <n>] [--host [addr]] [--db <path>] [--auto-approve] [--dev]

  --port <n>       listen port (default 8788; env HASNA_NOTES_SERVER_PORT or PORT)
  --host [addr]    bind address (default 127.0.0.1; bare --host binds 0.0.0.0)
  --db <path>      SQLite file (default ~/.hasna/notes/server.db via @hasna/paths,
                   the XDG data home is adopted once HASNA_DATA_HOME is set or the
                   store is migrated there;
                   PostgreSQL is selected by HASNA_NOTES_DATABASE_URL instead)
  --auto-approve   auto-approve device logins from loopback (single-user convenience)
  --dev            include devCode in OTP login responses (for tests/dev)
  -V, --version    output the version number
  -h, --help       display help for command`);

  process.exit(0);
}

const config = resolveConfig(process.env, process.argv.slice(2));
// One-time copy-forward of a legacy default server DB into the canonical
// default path. Only runs when the default path is in use (no --db / env
// override) — an explicit path is the caller's choice, never touched.
if (config.dbPath === DEFAULT_DB_PATH) {
  migrateLegacyServerDb(config.dbPath, LEGACY_DB_PATH);
}
const store = openStorage(process.env, { sqlitePath: config.dbPath });
const app = await createApp({ db: store.db, config });

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  // Pass the client IP through as Hono env — used to gate --auto-approve to loopback.
  fetch: (req, srv) => app.fetch(req, { ip: srv.requestIP(req)?.address ?? '' }),
});

console.log(`[${SERVICE}] v${VERSION} listening on http://${config.host}:${server.port}`);
if (store.backend === 'postgresql') {
  console.log(`[${SERVICE}] database: postgresql (HASNA_NOTES_DATABASE_URL)`);
} else {
  console.log(`[${SERVICE}] database: ${config.dbPath}`);
}
if (config.autoApprove) console.log(`[${SERVICE}] --auto-approve on: loopback device logins complete without manual approval`);
if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
  console.log(`[${SERVICE}] WARNING: bound to ${config.host} — put a TLS reverse proxy in front before exposing beyond your LAN`);
}
