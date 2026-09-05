#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * Exercises the notes server's OWN PostgreSQL code path against a real
 * server: applies the PG schema through the MigrationLedger (the same
 * migration list scripts/apply-postgres-migrations.mjs applies), then runs
 * the storage-neutral server layer (openPgAdapter + createApp) against it
 * and completes an OTP login + note write/read round-trip.
 *
 * FAIL-CLOSED BY DESIGN. With no DSN set this exits 2 rather than skipping: a
 * proof gate that reports success when it did not run is the vacuous check the
 * contract's storage clause exists to prevent. The DSN variable is TEST-ONLY
 * and deliberately distinct from `HASNA_NOTES_DATABASE_URL`, so pointing the
 * gate at a live store takes a separate, explicit act.
 *
 *   NOTES_TEST_DATABASE_URL=postgres://... bun run test:pg
 *
 * The connection string is never printed, in full or in part. Probe rows are
 * removed by the gate's own schema (each run mints a fresh tenant/keys).
 */
import { MigrationLedger } from '../src/generated/storage-kit/index.js';
import { notesPgMigrations } from '../server/pg-migrations.ts';
import { openPgAdapter } from '../server/pg-adapter.mjs';
import { createApp, resolveConfig } from '../server/app.mjs';

const ENV_VAR = 'NOTES_TEST_DATABASE_URL';
const SIGNING_SECRET = 'notes-pg-test-gate-signing-secret-32b!';

function fail(message) {
  console.error(`[pg-test-gate] FAIL: ${message}`);
  process.exit(1);
}

const connectionString = process.env[ENV_VAR]?.trim();
if (!connectionString) {
  console.error(
    `[pg-test-gate] FAIL: ${ENV_VAR} is not set. This gate proves live PostgreSQL support and cannot ` +
      `pass without a PostgreSQL server; point it at a throwaway test database.`,
  );
  process.exit(2);
}

let db;
let checks = 0;

async function main() {
  db = openPgAdapter({ connectionString, applicationName: '@hasna/notes pg-test-gate' });

  // 1. Schema — the repo's own migration set must apply cleanly.
  const ledger = new MigrationLedger(db.client, notesPgMigrations());
  const result = await ledger.migrate();
  if (result.applied.length === 0) fail('no PostgreSQL migrations were found to apply');
  checks++;

  // 2. The server on the postgres backend: OTP login mints a contracts api
  //    key, and that key authenticates a note write/read round-trip.
  const config = resolveConfig({ HASNA_NOTES_API_SIGNING_KEY: SIGNING_SECRET }, ['--dev']);
  const app = await createApp({ db, config });

  const login = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `pg-gate-${crypto.randomUUID()}@example.test` }),
  }, { ip: '127.0.0.1' });
  const loginBody = await login.json();
  if (!loginBody.devCode) fail('OTP login did not return a dev code');
  checks++;

  const verify = await app.request('/api/v1/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: loginBody.email, code: loginBody.devCode, requestId: loginBody.requestId, name: 'PG Gate' }),
  }, { ip: '127.0.0.1' });
  const verifyBody = await verify.json();
  if (!verifyBody.apiKey || !String(verifyBody.apiKey).startsWith('hasna_notes_')) {
    fail('verify did not mint a contracts api key');
  }
  checks++;

  const created = await app.request('/api/v1/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${verifyBody.apiKey}` },
    body: JSON.stringify({ title: 'pg-test-gate note', bodyMarkdown: 'round-trip' }),
  }, { ip: '127.0.0.1' });
  const createdBody = await created.json();
  if (created.status !== 201 || createdBody.title !== 'pg-test-gate note') {
    fail('note create through the postgres backend failed');
  }
  checks++;

  const got = await app.request(`/api/v1/notes/${createdBody.id}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${verifyBody.apiKey}` },
  }, { ip: '127.0.0.1' });
  const gotBody = await got.json();
  if (got.status !== 200 || gotBody.bodyMarkdown !== 'round-trip') {
    fail('note read-back through the postgres backend failed');
  }
  checks++;

  // 3. The postgres schema has no sync_batches (sync is removed there).
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'").all())
    .map((r) => r.tablename);
  if (tables.includes('sync_batches')) fail('sync_batches must be absent from the postgresql schema');
  checks++;

  console.log(`[pg-test-gate] PASS: ${checks} live PostgreSQL checks (schema, api-key mint, note round-trip, no sync_batches)`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
}).finally(async () => {
  if (db) await db.close();
});
