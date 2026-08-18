/**
 * MON-V2-02 gate tests for migration 008_monitor_v2.sql.
 *
 * Gate (design §9, MON-V2-02): "Apply migration twice to a copied 0.1.26
 * database; require `PRAGMA integrity_check` output `ok`, unchanged legacy
 * rows, enforced foreign keys, and all uniqueness constraints."
 *
 * The tests build a genuine 0.1.26 database by replaying migrations 001-007
 * through the same semantics as runMigrations() in db/client.ts (PRAGMA lines
 * stripped, whole file in one transaction, recorded in _migrations), seed it,
 * copy the file, apply 008 twice, and assert the gate.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

const LEGACY_MIGRATIONS = [
  "001_init.sql",
  "002_fts.sql",
  "003_agents.sql",
  "004_feedback.sql",
  "005_elapsed_sec.sql",
  "006_cron_defaults.sql",
  "007_send_report_cron_action.sql",
];

const V2_MIGRATION = "008_monitor_v2.sql";

const V2_TABLES = [
  "slugs",
  "slug_revisions",
  "slug_control_requests",
  "slug_runs",
  "slug_attempts",
  "leases",
  "slug_effects",
  "receipts",
  "daemon_state",
];

const LEGACY_TABLES = [
  "machines",
  "metrics",
  "processes",
  "alerts",
  "cron_jobs",
  "cron_runs",
  "doctor_rules",
  "agents",
  "feedback",
  "machines_fts",
];

const scratch = mkdtempSync(join(tmpdir(), "monitor-v2-migrate-"));

/**
 * Mirrors runMigrations() semantics from db/client.ts: strip PRAGMA lines
 * (they cannot run inside a transaction), run the whole file in one
 * transaction, and record the file name in _migrations.
 */
function applyMigrationFile(db: Database, file: string): void {
  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const sql = raw
    .split("\n")
    .filter((l) => !/^\s*PRAGMA\s/i.test(l))
    .join("\n");
  db.transaction(() => {
    db.run(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
  })();
}

/** Applies a list of migration files, skipping any already recorded. */
function applyMigrations(db: Database, files: string[]): void {
  const applied = new Set<string>(
    (
      db
        .prepare("SELECT name FROM _migrations")
        .all() as { name: string }[]
    ).map((r) => r.name)
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    applyMigrationFile(db, file);
  }
}

/** Executes a migration file's raw SQL without recording (idempotency probe). */
function applyRaw(db: Database, file: string): void {
  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const sql = raw
    .split("\n")
    .filter((l) => !/^\s*PRAGMA\s/i.test(l))
    .join("\n");
  db.run(sql);
}

function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  // Default rollback journal (no WAL): the file copy must be self-contained
  // and reflect every committed write, which WAL sidecars would break.
  db.run("PRAGMA journal_mode = DELETE");
  db.run("PRAGMA foreign_keys = ON");
  db.run(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL DEFAULT (unixepoch()))"
  );
  return db;
}

function seedLegacy(db: Database): void {
  // machines
  db.run(
    "INSERT INTO machines (id, name, type, host, port, ssh_key_path, tags, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["m1", "station01", "local", null, null, null, "{}", "online"]
  );
  db.run(
    "INSERT INTO machines (id, name, type, host, port, ssh_key_path, tags, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["m2", "station02", "ssh", "station02.tailnet", 22, "/home/hasna/.ssh/id_ed25519", '{"region":"eu"}', "offline"]
  );
  // metrics
  for (let i = 0; i < 3; i++) {
    db.run(
      "INSERT INTO metrics (machine_id, cpu_percent, mem_used_mb, mem_total_mb, disk_used_gb, disk_total_gb, load_avg_1, load_avg_5, load_avg_15, process_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["m1", 10 + i, 2048 + i, 8192, 100 + i, 512, 0.5, 0.4, 0.3, 42]
    );
  }
  db.run(
    "INSERT INTO metrics (machine_id, cpu_percent, mem_used_mb, mem_total_mb, disk_used_gb, disk_total_gb, load_avg_1, load_avg_5, load_avg_15, process_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["m2", 2.5, 512, 4096, 50, 256, 0.1, 0.1, 0.1, 7]
  );
  // processes
  db.run(
    "INSERT INTO processes (machine_id, pid, ppid, name, cmd, user, status, is_zombie, elapsed_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["m1", 1001, 1, "bun", "/usr/local/bin/bun", "hasna", "running", 0, 3600]
  );
  db.run(
    "INSERT INTO processes (machine_id, pid, ppid, name, cmd, user, status, is_zombie, elapsed_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["m1", 1002, 1, "sshd", "/usr/sbin/sshd", "root", "running", 0, 7200]
  );
  // alerts
  db.run(
    "INSERT INTO alerts (machine_id, severity, check_name, message, auto_resolved) VALUES (?, ?, ?, ?, ?)",
    ["m1", "warn", "load", "load average above 4", 0]
  );
  // cron_jobs: one legacy shell job beside the two seeds from 006
  db.run(
    "INSERT INTO cron_jobs (machine_id, name, schedule, command, action_type, action_config, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [null, "backup-daily", "0 2 * * *", "/usr/local/bin/backup.sh", "shell", "{}", 1]
  );
  // cron_runs
  db.run(
    "INSERT INTO cron_runs (cron_job_id, machine_id, started_at, finished_at, status, output, error) VALUES ((SELECT id FROM cron_jobs WHERE name = ?), ?, ?, ?, ?, ?, ?)",
    ["backup-daily", "m1", 1720000000, 1720000060, "ok", "backup complete", null]
  );
  db.run(
    "INSERT INTO cron_runs (cron_job_id, machine_id, started_at, finished_at, status, output, error) VALUES ((SELECT id FROM cron_jobs WHERE name = ?), ?, ?, ?, ?, ?, ?)",
    ["backup-daily", "m1", 1720000100, null, "fail", null, "exit 1"]
  );
  // doctor_rules
  db.run(
    "INSERT INTO doctor_rules (machine_id, name, check_type, threshold_warn, threshold_critical, enabled, auto_remediate, remediation_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [null, "load-check", "load", 4, 8, 1, 0, "{}"]
  );
  // agents
  db.run("INSERT INTO agents (id, name) VALUES (?, ?)", ["agent-1", "station01-agent"]);
  // feedback
  db.run(
    "INSERT INTO feedback (source, rating, message) VALUES (?, ?, ?)",
    ["user", 5, "all good"]
  );
}

function snapshot(db: Database): Record<string, string> {
  const out: Record<string, string> = {};
  for (const table of LEGACY_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    out[table] = JSON.stringify(rows);
  }
  return out;
}

function integrityOk(db: Database): boolean {
  const row = db
    .prepare<{ integrity_check: string }, []>("PRAGMA integrity_check")
    .get();
  return row?.integrity_check === "ok";
}

function expectConstraintError(fn: () => void, re: RegExp): void {
  let message = "no error thrown";
  try {
    fn();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).toMatch(re);
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("008_monitor_v2 migration", () => {
  const legacyPath = join(scratch, "legacy-0126.db");
  const copyPath = join(scratch, "copied-0126.db");

  let db: Database;
  let legacySnapshot: Record<string, string>;

  // Build a genuine 0.1.26 database (migrations 001-007 + seeds), copy it,
  // then apply 008 twice.
  beforeAll(() => {
    // Clear any stale files left by an interrupted prior run (WAL sidecars
    // included), so the build always starts from a clean 0.1.26 baseline.
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(join(scratch, `legacy-0126.db${suffix}`), { force: true });
      rmSync(join(scratch, `copied-0126.db${suffix}`), { force: true });
    }
    db = openDb(legacyPath);
    applyMigrations(db, LEGACY_MIGRATIONS);
    seedLegacy(db);
    db.close();

    copyFileSync(legacyPath, copyPath);
    db = openDb(copyPath);
    legacySnapshot = snapshot(db);

    // First application: through the runner's recorded path.
    applyMigrations(db, [V2_MIGRATION]);
    // Second application: raw file execution (idempotency probe) — a
    // non-idempotent migration would fail or corrupt the schema here.
    applyRaw(db, V2_MIGRATION);
    // Runner semantics second time: already recorded, must be skipped.
    applyMigrations(db, [V2_MIGRATION]);
  });

  it("records the migration and creates all v2 tables", () => {
    const recorded = db
      .prepare<{ name: string }, [string]>("SELECT name FROM _migrations WHERE name = ?")
      .get(V2_MIGRATION);
    expect(recorded?.name).toBe(V2_MIGRATION);

    for (const table of V2_TABLES) {
      const row = db
        .prepare<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      expect(row?.name, `table ${table} exists`).toBe(table);
    }
  });

  it("reports integrity ok after applying twice", () => {
    expect(integrityOk(db)).toBe(true);
  });

  it("leaves legacy rows unchanged", () => {
    const after = snapshot(db);
    expect(Object.keys(after).sort()).toEqual(Object.keys(legacySnapshot).sort());
    for (const table of LEGACY_TABLES) {
      expect(after[table], `legacy table ${table} unchanged`).toBe(legacySnapshot[table]);
    }
  });

  it("enforces foreign keys", () => {
    // Connection-level enforcement is on, mirroring db/client.ts.
    const fk = db.prepare<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
    expect(fk?.foreign_keys).toBe(1);

    // Legacy FK: metrics.machine_id must exist in machines.
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO metrics (machine_id, cpu_percent, mem_used_mb, mem_total_mb, disk_used_gb, disk_total_gb, load_avg_1, load_avg_5, load_avg_15) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ["no-such-machine", 1, 1, 1, 1, 1, 0, 0, 0]
        ),
      /FOREIGN KEY constraint failed/
    );

    // V2 FK: slug_revisions.slug_id must exist in slugs.
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO slug_revisions (id, slug_id, revision, definition_json, definition_digest, created_by) VALUES (?, ?, ?, ?, ?, ?)",
          ["rev-orphan", "no-slug", 1, "{}", "digest", "test"]
        ),
      /FOREIGN KEY constraint failed/
    );

    // V2 FK: leases.run_id must exist in slug_runs.
    db.run(
      "INSERT INTO slugs (id, name) VALUES (?, ?)",
      ["slug-a", "alpha"]
    );
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO leases (id, attempt_id, run_id, worker_id, generation, fencing_token_digest, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ["lease-orphan", "attempt-orphan", "run-orphan", "w1", 1, "digest", 9999999999]
        ),
      /FOREIGN KEY constraint failed/
    );

    // A valid chain inserts cleanly and cascades: deleting the slug removes
    // its revisions.
    db.run(
      "INSERT INTO slug_revisions (id, slug_id, revision, definition_json, definition_digest, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      ["rev-a1", "slug-a", 1, "{}", "digest-a", "test"]
    );
    db.run("DELETE FROM slugs WHERE id = ?", ["slug-a"]);
    const orphan = db
      .prepare<{ id: string }, [string]>("SELECT id FROM slug_revisions WHERE id = ?")
      .get("rev-a1");
    expect(orphan).toBeNull();
  });

  it("enforces every uniqueness constraint", () => {
    db.run("INSERT INTO slugs (id, name) VALUES (?, ?)", ["slug-u1", "unique-1"]);
    db.run(
      "INSERT INTO slug_revisions (id, slug_id, revision, definition_json, definition_digest, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      ["rev-u1", "slug-u1", 1, "{}", "d", "test"]
    );
    db.run(
      "INSERT INTO slug_control_requests (id, idempotency_key, slug_id, operation, request_digest, result_json) VALUES (?, ?, ?, ?, ?, ?)",
      ["ctrl-u1", "key-1", "slug-u1", "start", "digest", "{}"]
    );
    db.run(
      "INSERT INTO slug_runs (id, slug_id, revision_id, admission_key, state, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["run-u1", "slug-u1", "rev-u1", "admission-1", "admitted", 1720000000]
    );
    db.run(
      "INSERT INTO slug_attempts (id, run_id, attempt_number, state) VALUES (?, ?, ?, ?)",
      ["attempt-u1", "run-u1", 1, "leased"]
    );
    db.run(
      "INSERT INTO leases (id, attempt_id, run_id, worker_id, generation, fencing_token_digest, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["lease-u1", "attempt-u1", "run-u1", "w1", 1, "digest", 9999999999]
    );
    db.run(
      "INSERT INTO slug_effects (id, run_id, effect_key, integration, operation, target) VALUES (?, ?, ?, ?, ?, ?)",
      ["effect-u1", "run-u1", "effect-key-1", "todos", "createTask", "task"]
    );
    db.run(
      "INSERT INTO receipts (id, run_id, lease_generation, state, result_digest) VALUES (?, ?, ?, ?, ?)",
      ["receipt-u1", "run-u1", 1, "terminal", "digest"]
    );

    // 1. unique slug names
    expectConstraintError(
      () => db.run("INSERT INTO slugs (id, name) VALUES (?, ?)", ["slug-u2", "unique-1"]),
      /UNIQUE constraint failed/
    );
    // 2. unique slug revisions per slug
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO slug_revisions (id, slug_id, revision, definition_json, definition_digest, created_by) VALUES (?, ?, ?, ?, ?, ?)",
          ["rev-u1b", "slug-u1", 1, "{}", "d", "test"]
        ),
      /UNIQUE constraint failed/
    );
    // 3. unique idempotency key per slug
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO slug_control_requests (id, idempotency_key, slug_id, operation, request_digest, result_json) VALUES (?, ?, ?, ?, ?, ?)",
          ["ctrl-u1b", "key-1", "slug-u1", "start", "digest", "{}"]
        ),
      /UNIQUE constraint failed/
    );
    // 4. unique admission keys
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO slug_runs (id, slug_id, revision_id, admission_key, state, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)",
          ["run-u2", "slug-u1", "rev-u1", "admission-1", "admitted", 1720000000]
        ),
      /UNIQUE constraint failed/
    );
    // 5. unique attempt number per run
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO slug_attempts (id, run_id, attempt_number, state) VALUES (?, ?, ?, ?)",
          ["attempt-u1b", "run-u1", 1, "leased"]
        ),
      /UNIQUE constraint failed/
    );
    // 6. unique lease generation per run
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO leases (id, attempt_id, run_id, worker_id, generation, fencing_token_digest, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ["lease-u1b", "attempt-u1", "run-u1", "w1", 1, "digest", 9999999999]
        ),
      /UNIQUE constraint failed/
    );
    // 7. unique effect keys
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO slug_effects (id, run_id, effect_key, integration, operation, target) VALUES (?, ?, ?, ?, ?, ?)",
          ["effect-u1b", "run-u1", "effect-key-1", "todos", "createTask", "task"]
        ),
      /UNIQUE constraint failed/
    );
    // 8. unique run receipt
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO receipts (id, run_id, lease_generation, state, result_digest) VALUES (?, ?, ?, ?, ?)",
          ["receipt-u1b", "run-u1", 1, "terminal", "digest"]
        ),
      /UNIQUE constraint failed/
    );
  });

  it("creates the required indexes", () => {
    const required: Array<[string, string]> = [
      ["idx_slug_runs_slug_state_scheduled", "slug_runs"],
      ["idx_leases_expires_at", "leases"],
      ["idx_receipts_created_at", "receipts"],
    ];
    for (const [name, table] of required) {
      const row = db
        .prepare<{ name: string }, [string, string]>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ? AND tbl_name = ?"
        )
        .get(name, table);
      expect(row?.name, `index ${name} on ${table}`).toBe(name);
    }
  });

  it("permits a second active lease only for a different attempt", () => {
    db.run("INSERT INTO slugs (id, name) VALUES (?, ?)", ["slug-l", "lease-target"]);
    db.run(
      "INSERT INTO slug_runs (id, slug_id, admission_key, state, scheduled_at) VALUES (?, ?, ?, ?, ?)",
      ["run-l", "slug-l", "admission-l", "admitted", 1720000000]
    );
    db.run(
      "INSERT INTO slug_attempts (id, run_id, attempt_number, state) VALUES (?, ?, ?, ?)",
      ["attempt-l1", "run-l", 1, "leased"]
    );
    db.run(
      "INSERT INTO slug_attempts (id, run_id, attempt_number, state) VALUES (?, ?, ?, ?)",
      ["attempt-l2", "run-l", 2, "leased"]
    );
    // One non-revoked lease per attempt: first lease for attempt-l1 is fine.
    db.run(
      "INSERT INTO leases (id, attempt_id, run_id, worker_id, generation, fencing_token_digest, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["lease-l1", "attempt-l1", "run-l", "w1", 1, "digest", 9999999999]
    );
    // A second non-revoked lease for the same attempt is rejected.
    expectConstraintError(
      () =>
        db.run(
          "INSERT INTO leases (id, attempt_id, run_id, worker_id, generation, fencing_token_digest, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ["lease-l1b", "attempt-l1", "run-l", "w2", 2, "digest", 9999999999]
        ),
      /UNIQUE constraint failed/
    );
    // Revoking the first lease frees the attempt; a new lease is then allowed.
    db.run("UPDATE leases SET revoked_at = ? WHERE id = ?", [9999999999, "lease-l1"]);
    db.run(
      "INSERT INTO leases (id, attempt_id, run_id, worker_id, generation, fencing_token_digest, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["lease-l2", "attempt-l1", "run-l", "w2", 2, "digest", 9999999999]
    );
    expect(integrityOk(db)).toBe(true);
  });
});
