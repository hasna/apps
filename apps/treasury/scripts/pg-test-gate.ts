#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * Exercises the repo's OWN PostgreSQL code path against a real server: opens
 * the postgresql backend through the app's own `openDatabase` (migrations
 * included), then writes, reads, and removes a probe row — the same store and
 * SQL the postgresql backend uses at runtime.
 *
 * FAIL-CLOSED BY DESIGN. With no DSN set this exits 1 rather than skipping: a
 * proof gate that reports success when it did not run is the vacuous check the
 * contract's storage clause exists to prevent. The DSN variable is TEST-ONLY
 * and deliberately distinct from `HASNA_TREASURY_DATABASE_URL`, so pointing
 * the gate at a live store takes a separate, explicit act.
 *
 *   TREASURY_TEST_DATABASE_URL=postgres://... bun run test:pg
 *
 * The probe row is removed before exit; the connection string is never printed,
 * in full or in part, and the canonical env key is scrubbed after the run.
 */
import { randomUUID } from "node:crypto";
import { openDatabase, closeDatabase, resetDatabaseSingleton } from "../src/db/database.js";

const ENV_VAR = "TREASURY_TEST_DATABASE_URL";
const CANONICAL_KEY = "HASNA_TREASURY_DATABASE_URL";

function fail(message: string): never {
  console.error(`[pg-test-gate] FAIL: ${message}`);
  process.exit(1);
}

const connectionString = process.env[ENV_VAR]?.trim();
if (!connectionString) {
  fail(
    `${ENV_VAR} is not set. This gate proves live PostgreSQL support and cannot ` +
      "pass without a real server; set the test DSN explicitly to run it.",
  );
}

// Deliver the test DSN through the app's own resolution path (the canonical env
// key), then scrub it after the run so it never outlives the gate.
process.env[CANONICAL_KEY] = connectionString;

let db: Awaited<ReturnType<typeof openDatabase>>;
try {
  resetDatabaseSingleton();
  db = await openDatabase({ backend: "postgresql", fresh: true });
} catch (error) {
  fail(`connect/migrate failed: ${error instanceof Error ? error.message : String(error)}`);
}

const probeId = `pg-gate-probe-${randomUUID()}`;
const now = new Date().toISOString();
try {
  await db.run(
    `INSERT INTO entities (entity_id, entity_slug, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [probeId, null, "pg-gate-probe", "USD", now, now],
  );
  const readBack = await db.get<{ entity_id: string }>("SELECT entity_id FROM entities WHERE entity_id = ?", [probeId]);
  if (!readBack || readBack.entity_id !== probeId) {
    fail("probe row round-trip failed: inserted row could not be read back");
  }
  const migrations = await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM schema_migrations");
  if (Number(migrations?.c ?? 0) === 0) {
    fail("schema migrations reported 0 applied after connect");
  }
  await db.run("DELETE FROM entities WHERE entity_id = ?", [probeId]);
  const after = await db.get<{ c: number }>("SELECT COUNT(*) AS c FROM entities WHERE entity_id = ?", [probeId]);
  if (Number(after?.c ?? 1) !== 0) {
    fail("probe row cleanup failed: row still present after delete");
  }
} catch (error) {
  fail(`probe round-trip failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await db.close().catch(() => undefined);
  delete process.env[CANONICAL_KEY];
}

console.log(
  "[pg-test-gate] ok: live PostgreSQL round-trip verified (migrate, insert, read-back, remove) through the app's own openDatabase",
);
