#!/usr/bin/env bun
// Hasna Notes self-hosted server — entrypoint.
// Run only with server-side PostgreSQL and signing credentials configured.
// One server backend, one wire dialect (personalnotes/v1): PostgreSQL selected
// by the mandatory HASNA_NOTES_DATABASE_URL. Missing/invalid configuration
// fails before the listener binds.
// The DSN is never logged. The PostgreSQL schema is applied by
// scripts/apply-postgres-migrations.mjs (owner role) before first run.
// Flags: --port <n> --host [addr] --auto-approve --dev
// Env:   HASNA_NOTES_SERVER_PORT|PORT, HASNA_NOTES_SERVER_HOST,
//        HASNA_NOTES_SERVER_URL, HASNA_NOTES_SERVER_AUTO_APPROVE=1,
//        HASNA_NOTES_SERVER_DEV=1,
//        HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1 (print OTP login codes to
//        the console — explicit opt-in; hosted/prod deploys must never set it),
//        HASNA_NOTES_SERVER_JWT_SECRET,
//        HASNA_NOTES_DATABASE_URL (mandatory server PostgreSQL URL),
//        HASNA_NOTES_API_SIGNING_KEY (postgresql backend api-key auth;
//        fallbacks API_KEY_SIGNING_SECRET, HASNA_API_SIGNING_KEY)

import { openStorage } from './storage.mjs';
import { createApp, resolveConfig, SERVICE, VERSION } from './app.mjs';

// Binds-before-version class (todos row 7e5f8f3d): --version must answer
// BEFORE resolveConfig()/Bun.serve. It previously fell through and bound the
// listener (:8788) with no output.
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  console.log(VERSION);
  process.exit(0);
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`${SERVICE} v${VERSION} — self-hosted Hasna Notes server (personalnotes/v1 dialect)

Usage: notes-serve [--port <n>] [--host [addr]] [--auto-approve] [--dev]
Requires server-only HASNA_NOTES_DATABASE_URL and HASNA_NOTES_API_SIGNING_KEY.

  --port <n>       listen port (default 8788; env HASNA_NOTES_SERVER_PORT or PORT)
  --host [addr]    bind address (default 127.0.0.1; bare --host binds 0.0.0.0)
  --auto-approve   auto-approve device logins from loopback (single-user convenience)
  --dev            include devCode in OTP login responses (for tests/dev);
                   OTP login codes are never logged — set
                   HASNA_NOTES_SERVER_AUTH_CONSOLE_CODES=1 to print them
  -V, --version    output the version number
  -h, --help       display help for command`);

  process.exit(0);
}

let store;
try {
  const config = resolveConfig(process.env, process.argv.slice(2));
  store = openStorage(process.env);
  const app = await createApp({ db: store.db, config });

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    // Pass the client IP through as Hono env — used to gate --auto-approve to loopback.
    fetch: (req, srv) => app.fetch(req, { ip: srv.requestIP(req)?.address ?? '' }),
  });

  console.log(`[${SERVICE}] v${VERSION} listening on http://${config.host}:${server.port}`);
  console.log(`[${SERVICE}] database: postgresql (HASNA_NOTES_DATABASE_URL)`);
  if (config.autoApprove) console.log(`[${SERVICE}] --auto-approve on: loopback device logins complete without manual approval`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    console.log(`[${SERVICE}] WARNING: bound to ${config.host} — put a TLS reverse proxy in front before exposing beyond your LAN`);
  }
} catch {
  // Driver errors can contain connection details. Never print the error/DSN.
  console.error('notes-server: startup failed; verify server-only HASNA_NOTES_DATABASE_URL, signing key, schema and connectivity. PostgreSQL is mandatory; no local fallback.');
  if (store) await store.close().catch(() => {});
  process.exit(1);
}
