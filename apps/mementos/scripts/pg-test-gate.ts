#!/usr/bin/env bun
/**
 * Live PostgreSQL proof gate — `storage.pgTestGate` in hasna.contract.json.
 *
 * Exercises the repo's OWN PostgreSQL code path against a real server:
 * applies the PG schema through {@link applyPgMigrations}, then writes and
 * reads a row back through {@link PgAdapterAsync} — the same adapter and SQL
 * translation the postgres storage engine uses at runtime.
 *
 * FAIL-CLOSED BY DESIGN. With no DSN set this exits 1 rather than skipping: a
 * proof gate that reports success when it did not run is the vacuous check the
 * contract's storage clause exists to prevent. The DSN variable is TEST-ONLY
 * and deliberately distinct from `HASNA_MEMENTOS_DATABASE_URL`, so pointing
 * the gate at a live store takes a separate, explicit act.
 *
 *   MEMENTOS_TEST_DATABASE_URL=postgres://... bun run test:pg
 *
 * The probe rows are deleted before exit; the connection string is never
 * printed, in full or in part.
 */
import { createHash } from "node:crypto";
import { PgAdapter, PgAdapterAsync } from "../src/storage.js";
import { applyPgMigrations } from "../src/db/pg-migrate.js";
import {
  getMementosProjectResourceExact,
  readAllMementosProjectResources,
  readMementosProjectResourcePage,
} from "../src/project-registration/project-resources.js";

const ENV_VAR = "MEMENTOS_TEST_DATABASE_URL";

function fail(message: string): never {
  console.error(`[pg-test-gate] FAIL: ${message}`);
  process.exit(1);
}

const connectionString = process.env[ENV_VAR]?.trim();
if (!connectionString) {
  fail(
    `${ENV_VAR} is not set. This gate proves live PostgreSQL support and cannot ` +
      `pass without a PostgreSQL server; point it at a throwaway test database.`
  );
}

const pg = new PgAdapterAsync(connectionString);
const probeSuffix = crypto.randomUUID();
const agentId = crypto.randomUUID();
const memoryId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const knowledgeId = crypto.randomUUID();
const sessionJobId = crypto.randomUUID();
const laterMemoryId = crypto.randomUUID();
const probeKey = `pg-test-gate-${probeSuffix}`;
const probeValue = `pg-test-gate value ${probeSuffix}`;
let checks = 0;

try {
  // 1. Schema — the repo's own migration set must apply cleanly.
  const migrations = await applyPgMigrations(connectionString);
  if (migrations.errors.length > 0) fail(`migration errors: ${migrations.errors.join("; ")}`);
  if (migrations.totalMigrations === 0) fail("no PostgreSQL migrations were found to apply");
  checks++;

  // 2. Write and read back through the postgres adapter.
  await pg.run(
    "INSERT INTO agents (id, name, role) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    agentId,
    `pg-test-gate-agent-${agentId.slice(0, 8)}`,
    "agent"
  );
  await pg.run(
    `INSERT INTO memories (id, key, value, category, scope, importance, source, status, agent_id)
     VALUES ($1, $2, $3, 'knowledge', 'private', 5, 'system', 'active', $4)`,
    memoryId,
    probeKey,
    probeValue,
    agentId
  );
  const recalled = await pg.get("SELECT id, key, value, status FROM memories WHERE key = $1", probeKey);
  if (!recalled) fail("round-trip read returned no row: the postgres write path did not persist");
  if (recalled.id !== memoryId || recalled.value !== probeValue) {
    fail("round-trip mismatch: the row read back is not the row written");
  }
  checks++;

  // 3. The delete path, so the gate leaves no residue and proves a mutation
  //    other than INSERT reaches the server.
  await pg.run("DELETE FROM memories WHERE id = $1", memoryId);
  const afterDelete = await pg.get("SELECT id FROM memories WHERE id = $1", memoryId);
  if (afterDelete) fail("delete did not remove the probe row");
  checks++;

  // 4. Audit value hashes are REAL digests, not fabricated data.
  //
  //    The SQLite triggers wrote `hex(randomblob(16))` here until migration 37,
  //    because SQLite has no md5(); they now write NULL. Postgres has md5() and
  //    must write the true digest — this is the half of that contract that only a
  //    live server can prove. Asserting the column is merely POPULATED would pass
  //    on random data, which is exactly how the SQLite defect survived, so both
  //    assertions below compare against the digest of a value this gate knows.
  const expectedDigest = createHash("md5").update(probeValue, "utf8").digest("hex");

  const createdAudit = await pg.get(
    "SELECT new_value_hash FROM memory_audit_log WHERE memory_id = $1 AND operation = 'create'",
    memoryId
  );
  if (!createdAudit) fail("no 'create' audit row: the audit_memory_insert trigger did not fire");
  if (createdAudit.new_value_hash !== expectedDigest) {
    fail(
      `create audit new_value_hash is not md5 of the written value ` +
        `(expected ${expectedDigest}, got ${String(createdAudit.new_value_hash)})`
    );
  }

  const deletedAudit = await pg.get(
    "SELECT old_value_hash FROM memory_audit_log WHERE memory_id = $1 AND operation = 'delete'",
    memoryId
  );
  if (!deletedAudit) fail("no 'delete' audit row: the audit_memory_delete trigger did not fire");
  if (deletedAudit.old_value_hash !== expectedDigest) {
    fail(
      `delete audit old_value_hash is not md5 of the deleted value ` +
        `(expected ${expectedDigest}, got ${String(deletedAudit.old_value_hash)})`
    );
  }
  checks++;

  // 5. The public producer population must use the same storage-neutral SQL
  //    path on PostgreSQL as SQLite: project + disjoint knowledge/memory
  //    partitions + session job, exact readback, later-child inclusion, and a
  //    revision-bound cursor that refuses a changed collection.
  await pg.run(
    "INSERT INTO projects (id, name, path) VALUES ($1, $2, $3)",
    projectId,
    `pg-producer-project-${probeSuffix}`,
    `/pg-producer/${probeSuffix}`,
  );
  await pg.run(
    `INSERT INTO memories (id, key, value, category, scope, importance, source, status, project_id)
     VALUES ($1, $2, $3, 'knowledge', 'private', 5, 'system', 'active', $4)`,
    knowledgeId,
    `pg-producer-knowledge-${probeSuffix}`,
    "knowledge",
    projectId,
  );
  await pg.run(
    `INSERT INTO memories (id, key, value, category, scope, importance, source, status, project_id)
     VALUES ($1, $2, $3, 'history', 'private', 5, 'system', 'active', $4)`,
    memoryId,
    probeKey,
    probeValue,
    projectId,
  );
  await pg.run(
    `INSERT INTO session_memory_jobs (id, session_id, project_id, source, status, transcript)
     VALUES ($1, $2, $3, 'manual', 'pending', $4)`,
    sessionJobId,
    `pg-producer-session-${probeSuffix}`,
    projectId,
    "session transcript",
  );

  const syncPg = new PgAdapter(connectionString);
  try {
    const firstPage = readMementosProjectResourcePage(
      projectId,
      { limit: 1 },
      syncPg,
      {
        authorityId: "mementos-pg-test",
        tenantId: "tenant-pg-test",
        corpusId: "corpus-pg-test",
      },
    );
    const complete = readAllMementosProjectResources(
      projectId,
      { page_size: 1 },
      syncPg,
      {
        authorityId: "mementos-pg-test",
        tenantId: "tenant-pg-test",
        corpusId: "corpus-pg-test",
      },
    );
    const stableKeys = complete.resources.map(
      (resource) => `${resource.resource_kind}:${resource.stable_id}`,
    );
    if (
      complete.total !== 4
      || complete.count !== 4
      || new Set(stableKeys).size !== 4
      || complete.has_more
      || complete.next_cursor !== null
    ) {
      fail("PostgreSQL project-resource traversal was incomplete or duplicated");
    }
    const exact = getMementosProjectResourceExact(
      projectId,
      "memory",
      memoryId,
      syncPg,
      {
        authorityId: "mementos-pg-test",
        tenantId: "tenant-pg-test",
        corpusId: "corpus-pg-test",
      },
    );
    if (exact.resource.stable_id !== memoryId) {
      fail("PostgreSQL project-resource exact readback changed the stable ID");
    }

    await pg.run(
      `INSERT INTO memories (id, key, value, category, scope, importance, source, status, project_id)
       VALUES ($1, $2, $3, 'fact', 'private', 5, 'system', 'active', $4)`,
      laterMemoryId,
      `pg-producer-later-${probeSuffix}`,
      "later",
      projectId,
    );
    const later = readAllMementosProjectResources(
      projectId,
      { page_size: 1 },
      syncPg,
      {
        authorityId: "mementos-pg-test",
        tenantId: "tenant-pg-test",
        corpusId: "corpus-pg-test",
      },
    );
    if (
      later.total !== 5
      || !later.resources.some((resource) => resource.stable_id === laterMemoryId)
    ) {
      fail("PostgreSQL fresh traversal omitted the later explicit project child");
    }
    let changedCursorRefused = false;
    try {
      readMementosProjectResourcePage(
        projectId,
        { limit: 1, cursor: firstPage.next_cursor },
        syncPg,
        {
          authorityId: "mementos-pg-test",
          tenantId: "tenant-pg-test",
          corpusId: "corpus-pg-test",
        },
      );
    } catch (error) {
      changedCursorRefused = error instanceof Error
        && /collection changed/i.test(error.message);
    }
    if (!changedCursorRefused) {
      fail("PostgreSQL revision-bound cursor did not refuse a changed collection");
    }
  } finally {
    syncPg.close();
  }
  checks++;

  // 6. The PgSyncPool stale-response race against a real server (todos
  //    027d17e9): a query that outlives the (env-shortened) query timeout is
  //    abandoned, and the worker's LATE response for it must never be consumed
  //    by the next query. The sleep's response lands while the victim query is
  //    waiting, so a leak shows up as the victim receiving marker_a.
  //
  //    The timeout env is shortened for the sleep query ONLY and restored
  //    before the victim query, whose own response arrives after pg_sleep(5)
  //    finishes (≈5s later) and needs the normal 60s budget to still be
  //    waiting when it does.
  const originalTimeout = process.env["MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS"];
  process.env["MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS"] = "2000";
  const racePool = new PgAdapter(connectionString);
  try {
    let timedOut = false;
    try {
      racePool.get("SELECT pg_sleep(5), 42 AS marker_a", []);
    } catch (error) {
      timedOut = error instanceof Error && /PostgreSQL query timed out/.test(error.message);
    }
    if (!timedOut) {
      fail("pg_sleep query did not time out under the shortened query timeout");
    }
  } finally {
    if (originalTimeout === undefined) {
      delete process.env["MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS"];
    } else {
      process.env["MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS"] = originalTimeout;
    }
  }
  try {
    const victim = racePool.get("SELECT 7 AS marker_b", []);
    if (!victim || victim.marker_b !== 7 || "marker_a" in victim) {
      fail(
        "query after a timed-out query consumed the stale predecessor response " +
          `(expected marker_b === 7, got ${JSON.stringify(victim)})`
      );
    }
    checks++;
  } finally {
    racePool.close();
  }

  console.log(
    `[pg-test-gate] PASS: ${checks} live PostgreSQL checks (schema, round-trip, delete, audit-value-hash, project-resources, stale-response race)`
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await pg.run("DELETE FROM memories WHERE id = $1", memoryId).catch(() => {});
  await pg.run("DELETE FROM memories WHERE id = $1", knowledgeId).catch(() => {});
  await pg.run("DELETE FROM memories WHERE id = $1", laterMemoryId).catch(() => {});
  await pg.run("DELETE FROM session_memory_jobs WHERE id = $1", sessionJobId).catch(() => {});
  await pg.run("DELETE FROM projects WHERE id = $1", projectId).catch(() => {});
  await pg.run("DELETE FROM agents WHERE id = $1", agentId).catch(() => {});
  await pg.close();
}
