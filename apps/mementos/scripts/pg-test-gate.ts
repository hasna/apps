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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgAdapter, PgAdapterAsync, markServerContext } from "../src/storage.js";
import { applyPgMigrations } from "../src/db/pg-migrate.js";
import { PG_MIGRATIONS } from "../src/db/pg-migrations.js";
import { closeDatabase, resetDatabase } from "../src/db/database.js";
import { matchRoute } from "../src/server/router.js";
import "../src/server/routes/agents.js";
import { MachineRegistryError, registerMachineRecord } from "../src/db/machines.js";
import { acquireLock, checkLock, releaseLock } from "../src/db/locks.js";
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
const machineHostname = `pg-machine-${probeSuffix}`;
const invalidMachineId = crypto.randomUUID();
const probeKey = `pg-test-gate-${probeSuffix}`;
const probeValue = `pg-test-gate value ${probeSuffix}`;
const machineIdentityMigration = PG_MIGRATIONS.find((migration) =>
  migration.includes("mementos_m41_machine_preflight")
);
if (!machineIdentityMigration) fail("PostgreSQL machine identity migration is missing");
const machineIdentityMigrationIndex = PG_MIGRATIONS.indexOf(machineIdentityMigration);
let checks = 0;

try {
  // 1. Schema — the repo's own migration set must apply cleanly.
  const [migrations, concurrentMigrations] = await Promise.all([
    applyPgMigrations(connectionString),
    applyPgMigrations(connectionString),
  ]);
  for (const migrationRun of [migrations, concurrentMigrations]) {
    if (migrationRun.errors.length > 0) fail(`migration errors: ${migrationRun.errors.join("; ")}`);
    if (migrationRun.totalMigrations === 0) fail("no PostgreSQL migrations were found to apply");
  }
  const appliedVersions = migrations.applied.length + concurrentMigrations.applied.length;
  if (appliedVersions !== migrations.totalMigrations) {
    fail("concurrent migration runners did not apply every version exactly once");
  }
  const hostnameConstraint = await pg.get(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'machines_hostname_canonical'",
  );
  if (!hostnameConstraint || !String(hostnameConstraint.definition).includes("lower")) {
    fail("machine hostname canonicalization is not database-enforced");
  }
  let nonCanonicalRefused = false;
  try {
    await pg.run(
      "INSERT INTO machines (id, name, hostname, platform) VALUES ($1, $2, $3, $4)",
      invalidMachineId,
      `invalid-machine-${probeSuffix}`,
      "UPPER-HOST.",
      "linux",
    );
  } catch {
    nonCanonicalRefused = true;
  }
  if (!nonCanonicalRefused) fail("PostgreSQL accepted a noncanonical machine hostname");
  checks++;

  // Migration-41 negative controls. Seed each legacy-invalid row only after
  // dropping the final runtime constraints inside a transaction, then execute
  // the exact migration body. Its preflight must fail, and the outer
  // transaction must restore rows, constraints, and the migration receipt.
  const invalidMigrationCases = [
    {
      label: "control-character name",
      id: `pg-invalid-name-${probeSuffix}`,
      name: `bad\nname-${probeSuffix}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
    {
      label: "reversed liveness timestamps",
      id: `pg-invalid-time-${probeSuffix}`,
      name: `pg-invalid-time-${probeSuffix}`,
      createdAt: "2026-02-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  for (const invalidCase of invalidMigrationCases) {
    let refused = false;
    try {
      await pg.transaction(async (client) => {
        await client.query("DELETE FROM _pg_migrations WHERE version = $1", [machineIdentityMigrationIndex]);
        await client.query("DELETE FROM _migrations WHERE id = 41");
        await client.query("ALTER TABLE machines DROP CONSTRAINT IF EXISTS machines_name_runtime");
        await client.query("ALTER TABLE machines DROP CONSTRAINT IF EXISTS machines_liveness_runtime");
        await client.query(
          `INSERT INTO machines (id, name, hostname, platform, is_primary, created_at, last_seen_at)
           VALUES ($1, $2, $3, 'linux', FALSE, $4, $5)`,
          [invalidCase.id, invalidCase.name, invalidCase.id, invalidCase.createdAt, invalidCase.lastSeenAt],
        );
        await client.query(machineIdentityMigration);
        await client.query("INSERT INTO _pg_migrations (version) VALUES ($1)", [machineIdentityMigrationIndex]);
      });
    } catch {
      refused = true;
    }
    if (!refused) fail(`migration 41 accepted ${invalidCase.label}`);
    if (await pg.get("SELECT id FROM machines WHERE id = $1", invalidCase.id)) {
      fail(`migration 41 failed to roll back ${invalidCase.label} row`);
    }
    if (!(await pg.get("SELECT id FROM _migrations WHERE id = 41"))) {
      fail(`migration 41 failed to restore its schema receipt after ${invalidCase.label} refusal`);
    }
    if (!(await pg.get("SELECT version FROM _pg_migrations WHERE version = $1", machineIdentityMigrationIndex))) {
      fail(`migration 41 failed to restore its runner receipt after ${invalidCase.label} refusal`);
    }
    for (const constraintName of ["machines_name_runtime", "machines_liveness_runtime"]) {
      if (!(await pg.get("SELECT 1 FROM pg_constraint WHERE conname = $1", constraintName))) {
        fail(`migration 41 failed to restore ${constraintName} after ${invalidCase.label} refusal`);
      }
    }
    checks++;
  }

  // 2. Write and read back through the postgres adapter.
  await pg.run(
    "INSERT INTO agents (id, name, role) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    agentId,
    `pg-test-gate-agent-${agentId.slice(0, 8)}`,
    "agent"
  );
  const lockPg = new PgAdapter(connectionString);
  try {
    const lockResource = `pg-empty-lock-${probeSuffix}`;
    const empty = checkLock("memory", lockResource, undefined, lockPg as any);
    if (empty.length !== 0) fail("empty PostgreSQL lock lookup returned a lock");
    const acquired = acquireLock(agentId, "memory", lockResource, "exclusive", 60, lockPg as any);
    if (!acquired) fail("PostgreSQL lock acquisition returned no receipt");
    const visible = checkLock("memory", lockResource, undefined, lockPg as any);
    if (visible.length !== 1 || visible[0]?.id !== acquired.id) {
      fail("PostgreSQL lock lookup did not return the acquired lock");
    }
    if (!releaseLock(acquired.id, agentId, lockPg as any)) {
      fail("PostgreSQL lock release did not delete the acquired lock");
    }
    if (checkLock("memory", lockResource, undefined, lockPg as any).length !== 0) {
      fail("PostgreSQL empty lock lookup was not restored after release");
    }
  } finally {
    lockPg.close();
  }

  // Route-level regression for the production incident: the normal empty GET
  // must serialize [] with 200, never fail while comparing timestamptz to text.
  const originalDatabaseUrl = process.env["HASNA_MEMENTOS_DATABASE_URL"];
  process.env["HASNA_MEMENTOS_DATABASE_URL"] = connectionString;
  markServerContext();
  resetDatabase();
  try {
    const route = matchRoute("GET", "/api/locks");
    if (!route) fail("GET /api/locks route is not registered");
    const request = new Request(`http://mementos.test/api/locks?resource_type=memory&resource_id=missing-${probeSuffix}`);
    const response = await route.handler(request, new URL(request.url), route.params);
    const body = await response.json();
    if (response.status !== 200 || !Array.isArray(body) || body.length !== 0) {
      fail("GET /v1/locks did not return an empty 200 array for an unlocked resource");
    }
  } finally {
    closeDatabase();
    if (originalDatabaseUrl === undefined) delete process.env["HASNA_MEMENTOS_DATABASE_URL"];
    else process.env["HASNA_MEMENTOS_DATABASE_URL"] = originalDatabaseUrl;
  }
  checks++;
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

  // 7. Real cross-process concurrency through registerMachineRecord. Every
  // worker executes the synchronous server code path against its own Postgres
  // connection. The database unique hostname invariant must collapse all
  // simultaneous inserts to one stable id without a SELECT-before-INSERT race.
  await pg.run("DELETE FROM machines WHERE hostname = $1", machineHostname);
  const workerPath = new URL("./fixtures/pg-machine-register-worker.ts", import.meta.url).pathname;
  const barrierDir = mkdtempSync(join(tmpdir(), "mementos-pg-machine-barrier-"));
  const barrierFile = join(barrierDir, "release");
  const readyFiles = Array.from({ length: 12 }, (_, index) => join(barrierDir, `ready-${index}`));
  const workers = Array.from({ length: 12 }, (_, index) => Bun.spawn(
    ["bun", "run", workerPath],
    {
      env: {
        ...(process.env as Record<string, string>),
        HASNA_MEMENTOS_DATABASE_URL: connectionString,
        MEMENTOS_PG_MACHINE_HOSTNAME: machineHostname,
        MEMENTOS_PG_MACHINE_NAME: `concurrent-${index}`,
        MEMENTOS_PG_MACHINE_READY_FILE: readyFiles[index]!,
        MEMENTOS_PG_MACHINE_BARRIER_FILE: barrierFile,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  ));
  const readyDeadline = Date.now() + 10_000;
  while (!readyFiles.every(existsSync)) {
    if (Date.now() >= readyDeadline) fail("machine concurrency workers did not reach the start barrier");
    await Bun.sleep(10);
  }
  writeFileSync(barrierFile, "release", { mode: 0o600 });
  const receipts = await Promise.all(workers.map(async (worker, index) => {
    const [exitCode, stdout, stderr] = await Promise.all([
      worker.exited,
      new Response(worker.stdout).text(),
      new Response(worker.stderr).text(),
    ]);
    if (exitCode !== 0) {
      fail(`machine concurrency worker ${index} failed: ${stderr.trim() || "no diagnostic"}`);
    }
    try {
      return JSON.parse(stdout) as { id: string; name: string; hostname: string; created: boolean };
    } catch {
      fail(`machine concurrency worker ${index} returned malformed output`);
    }
  }));
  rmSync(barrierDir, { recursive: true, force: true });
  const stableIds = new Set(receipts.map((receipt) => receipt.id));
  const persistedNames = new Set(receipts.map((receipt) => receipt.name));
  if (stableIds.size !== 1 || persistedNames.size !== 1 || receipts.some((receipt) => receipt.hostname !== machineHostname)) {
    fail("concurrent machine registration did not converge on one stable identity and persisted winner name");
  }
  if (receipts.filter((receipt) => receipt.created).length !== 1) {
    fail("concurrent machine registration did not produce exactly one creator receipt");
  }
  const machineRows = await pg.all("SELECT id, hostname FROM machines WHERE hostname = $1", machineHostname);
  if (machineRows.length !== 1 || machineRows[0]?.id !== receipts[0]?.id) {
    fail("database hostname invariant did not retain exactly one machine row");
  }
  const conflictPg = new PgAdapter(connectionString);
  const conflictName = `pg-machine-name-${probeSuffix}`;
  const conflictHosts = [`pg-name-a-${probeSuffix}`, `pg-name-b-${probeSuffix}`];
  try {
    registerMachineRecord({ hostname: conflictHosts[0]!, platform: "linux", name: conflictName }, conflictPg as any);
    let nameConflictRefused = false;
    try {
      registerMachineRecord({ hostname: conflictHosts[1]!, platform: "linux", name: conflictName }, conflictPg as any);
    } catch (error) {
      nameConflictRefused = error instanceof MachineRegistryError && error.code === "MACHINE_NAME_CONFLICT";
    }
    if (!nameConflictRefused) fail("PostgreSQL machine registration did not classify a unique-name conflict");
  } finally {
    conflictPg.run("DELETE FROM machines WHERE hostname IN (?, ?)", conflictHosts[0], conflictHosts[1]);
    conflictPg.close();
  }
  const uniqueIndex = await pg.get(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_machines_hostname'`,
  );
  if (!uniqueIndex || !/CREATE UNIQUE INDEX/i.test(String(uniqueIndex.indexdef))) {
    fail("machine hostname identity index is not database-enforced as UNIQUE");
  }
  checks++;

  console.log(
    `[pg-test-gate] PASS: ${checks} live PostgreSQL checks (schema, canonical machine constraint, migration refusal/rollback, empty lock read/round-trip, memory round-trip, delete, audit-value-hash, project-resources, stale-response race, concurrent machine identity)`
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await pg.run("DELETE FROM memories WHERE id = $1", memoryId).catch(() => {});
  await pg.run("DELETE FROM memories WHERE id = $1", knowledgeId).catch(() => {});
  await pg.run("DELETE FROM memories WHERE id = $1", laterMemoryId).catch(() => {});
  await pg.run("DELETE FROM session_memory_jobs WHERE id = $1", sessionJobId).catch(() => {});
  await pg.run("DELETE FROM projects WHERE id = $1", projectId).catch(() => {});
  await pg.run("DELETE FROM machines WHERE id = $1", invalidMachineId).catch(() => {});
  await pg.run("UPDATE machines SET is_primary = FALSE WHERE hostname = $1", machineHostname).catch(() => {});
  await pg.run("DELETE FROM machines WHERE hostname = $1", machineHostname).catch(() => {});
  await pg.run("DELETE FROM agents WHERE id = $1", agentId).catch(() => {});
  await pg.close();
}
