#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * Exercises the messages app's OWN PostgreSQL code path against a real
 * server: PostgresMessagesStore (src/server/postgres-store.ts) — the same
 * store messages-serve uses when HASNA_MESSAGES_DATABASE_URL is set — then a
 * write/read/mark-read round-trip through the store contract.
 *
 * FAIL-CLOSED BY DESIGN. With no DSN set this exits 2 rather than skipping: a
 * proof gate that reports success when it did not run is the vacuous check
 * the contract's storage clause exists to prevent. The DSN variable is
 * TEST-ONLY and deliberately distinct from `HASNA_MESSAGES_DATABASE_URL`, so
 * pointing the gate at a live store takes a separate, explicit act.
 *
 *   MESSAGES_TEST_DATABASE_URL=postgres://... bun run test:postgres
 *
 * The connection string is never printed, in full or in part. Probe rows are
 * dropped by the gate itself through a dedicated cleanup pool.
 */
import pg from "pg";
import { PostgresMessagesStore } from "../src/server/postgres-store.js";

const ENV_VAR = "MESSAGES_TEST_DATABASE_URL";
const PROBE_THREAD = "t_pg_test_gate_probe__gate";
const PROBE_FROM = "pg_test_gate_sender";
const PROBE_TO = "pg_test_gate_recipient";

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

// The app's server path reads HASNA_MESSAGES_DATABASE_URL; the gate supplies
// it from the test-only variable, then scrubs it after connecting.
process.env["HASNA_MESSAGES_DATABASE_URL"] = connectionString;

const store = new PostgresMessagesStore(connectionString);
const cleanup = new pg.Pool({ connectionString });
try {
  await store.init();

  const now = new Date().toISOString();
  await store.upsertThread({
    id: PROBE_THREAD,
    agent_a: PROBE_FROM,
    agent_b: PROBE_TO,
    last_message_at: now,
    created_at: now,
  });
  await store.insertMessage({
    id: crypto.randomUUID(),
    thread_id: PROBE_THREAD,
    from_agent: PROBE_FROM,
    to_agent: PROBE_TO,
    content: "pg gate probe",
    reply_to: null,
    created_at: now,
    read_at: null,
  });

  const unread = await store.countUnread(PROBE_THREAD, PROBE_TO);
  if (unread !== 1) fail(`unread count expected 1, got ${unread}`);

  const messages = await store.listMessages(PROBE_THREAD);
  const probe = messages.find((m) => m.content === "pg gate probe");
  if (!probe) fail("write/read roundtrip did not return the probe message");
  if (probe.to_agent !== PROBE_TO) fail("write/read roundtrip returned a mismatched recipient");

  await store.markThreadRead(PROBE_THREAD, PROBE_TO, new Date().toISOString());
  const after = await store.countUnread(PROBE_THREAD, PROBE_TO);
  if (after !== 0) fail(`mark-read did not clear unread (still ${after})`);

  console.log("[pg-test-gate] PASS: PostgreSQL connection + write/read/mark-read roundtrip through the app's postgres path.");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  // The gate owns its probe rows: drop them, or fail.
  try {
    await cleanup.query("DELETE FROM messages WHERE thread_id = $1", [PROBE_THREAD]);
    await cleanup.query("DELETE FROM threads WHERE id = $1", [PROBE_THREAD]);
  } catch (error) {
    fail(`probe cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await store.close();
  } catch {
    // close failure is not the gate's signal; the roundtrip already decided
  }
  await cleanup.end();
  delete process.env["HASNA_MESSAGES_DATABASE_URL"];
  delete process.env[ENV_VAR];
}
