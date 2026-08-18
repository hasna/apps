#!/usr/bin/env bun
// Hasna Notes self-hosted server — entrypoint.
// Zero-ops run: `bun server/index.mjs` (repo) or `bunx notes-server`.
// Defaults: bind 127.0.0.1:8788, SQLite at ~/.hasna/apps/notes-server/server.db.
// Flags: --port <n> --host [addr] --db <path> --auto-approve --dev
// Env:   HASNA_NOTES_SERVER_PORT|PORT, HASNA_NOTES_SERVER_HOST,
//        HASNA_NOTES_SERVER_DB, HASNA_NOTES_SERVER_URL,
//        HASNA_NOTES_SERVER_AUTO_APPROVE=1, HASNA_NOTES_SERVER_DEV=1,
//        HASNA_NOTES_SERVER_JWT_SECRET

import { openDb } from './db.mjs';
import { createApp, resolveConfig, SERVICE, VERSION } from './app.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`${SERVICE} v${VERSION} — self-hosted Hasna Notes server (personalnotes/v1 dialect)

Usage: bun index.mjs [--port <n>] [--host [addr]] [--db <path>] [--auto-approve] [--dev]

  --port <n>       listen port (default 8788; env HASNA_NOTES_SERVER_PORT or PORT)
  --host [addr]    bind address (default 127.0.0.1; bare --host binds 0.0.0.0)
  --db <path>      SQLite file (default ~/.hasna/apps/notes-server/server.db)
  --auto-approve   auto-approve device logins from loopback (single-user convenience)
  --dev            include devCode in OTP login responses (for tests/dev)`);
  process.exit(0);
}

const config = resolveConfig(process.env, process.argv.slice(2));
const db = openDb(config.dbPath);
const app = createApp({ db, config });

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  // Pass the client IP through as Hono env — used to gate --auto-approve to loopback.
  fetch: (req, srv) => app.fetch(req, { ip: srv.requestIP(req)?.address ?? '' }),
});

console.log(`[${SERVICE}] v${VERSION} listening on http://${config.host}:${server.port}`);
console.log(`[${SERVICE}] database: ${config.dbPath}`);
if (config.autoApprove) console.log(`[${SERVICE}] --auto-approve on: loopback device logins complete without manual approval`);
if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
  console.log(`[${SERVICE}] WARNING: bound to ${config.host} — put a TLS reverse proxy in front before exposing beyond your LAN`);
}
