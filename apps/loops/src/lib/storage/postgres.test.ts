import { describe, expect, test } from "bun:test";
import { PostgresStorage } from "./postgres.js";
import { LOOP_MUTATION_ADVISORY_LOCK_SQL } from "./postgres-loop-storage.js";
import {
  POSTGRES_MIGRATION_ADVISORY_LOCK_SQL,
  POSTGRES_MIGRATION_LEDGER_TABLE,
  POSTGRES_STORAGE_MIGRATIONS,
  checksumStorageSql,
} from "./postgres-schema.js";
import type { PostgresQueryExecutor } from "./postgres.js";

class FakePostgresExecutor implements PostgresQueryExecutor {
  readonly executed: Array<{ sql: string; params?: readonly unknown[] }> = [];
  readonly queried: string[] = [];
  ledger: Array<{ id: string; checksum: string; applied_at: string }> = [];

  async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
    this.queried.push(sql);
    if (sql === POSTGRES_MIGRATION_ADVISORY_LOCK_SQL) return [];
    if (!sql.includes(POSTGRES_MIGRATION_LEDGER_TABLE)) throw new Error(`unexpected query: ${sql}`);
    return this.ledger as unknown as T[];
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    this.executed.push({ sql, params });
    if (sql.startsWith("INSERT INTO") && params) {
      this.ledger.push({
        id: String(params[0]),
        checksum: String(params[1]),
        applied_at: "2026-01-01T00:00:00.000Z",
      });
    }
  }

  async transaction<T>(fn: (executor: PostgresQueryExecutor) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe("Postgres storage migrations", () => {
  test("define a checksum-ledgered schema for core runtime, runners, and audit rows", () => {
    expect(POSTGRES_STORAGE_MIGRATIONS.map((migration) => migration.id)).toEqual([
      "0001_core_runtime",
      "0002_workflows_goals",
      "0003_remote_runners_and_audit",
      "0004_work_item_route_scope",
      "0005_run_receipts",
      "0006_work_item_machine_id",
      "0007_work_item_gate_deaths",
      "0011_workflow_run_provenance",
      "0012_loop_labels",
      "0008_tenant_prepare",
      "0009_tenant_backfill",
      "0010_tenant_enforce",
      "0013_loop_mutation_contract",
      "0014_loops_identity_aliases",
      "0014_loop_expires_after_runs",
      "0015_run_receipts_loop_cascade",
    ]);
    for (const migration of POSTGRES_STORAGE_MIGRATIONS) {
      expect(migration.checksum).toBe(checksumStorageSql(migration.sql));
      expect(migration.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    const combined = POSTGRES_STORAGE_MIGRATIONS.map((migration) => migration.sql).join("\n");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS loops");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS loop_runs");
    expect(combined).toContain("UNIQUE(loop_id, scheduled_for)");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS workflow_runs");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS runner_machines");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS runner_leases");
    expect(combined).toContain("idx_runner_leases_active_loop_run");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS audit_events");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS run_receipts");
  });

  test("released migration SQL is immutable — pinned checksums never change", () => {
    // Editing an already-released migration's SQL (instead of adding a new
    // additive migration) breaks every existing database: migrate() fails
    // closed with "checksum mismatch" because the ledger recorded the original
    // checksum. This pins the released checksums so that defect class fails
    // here first. The published npm/loops/v0.4.28 source contains migrations
    // through 0007; 0008-0010 were finalized after that tag and are pinned here
    // before their first package release. When adding schema, append a NEW
    // migration and pin it below — never touch a released block. (Regression:
    // route_scope was briefly folded
    // into 0002_workflows_goals, which would have bricked upgrades of every
    // existing postgres deployment.)
    const pinned: Record<string, string> = {
      "0001_core_runtime": "sha256:99cab06c75144cbcd3076ea42132fe511fe0f8c89d1c96bdcc4abef7c026ef32",
      "0002_workflows_goals": "sha256:cf9d74beafadaf97dcb26c3d584caa634265fb99978704417886c58d1f804b42",
      "0003_remote_runners_and_audit": "sha256:9f0816668315c08aefeda1afebb58ad74e803d6dd1bca580e0697f602486c520",
      "0004_work_item_route_scope": "sha256:341e439861d595ce3d069b0106f1f09134042bac0a70f3d00a1374e09f5404d9",
      "0005_run_receipts": "sha256:27228e19e0101d31ce9da18d76d918a96dd8afff576fb291cbf8d018e97fe5d6",
      "0006_work_item_machine_id": "sha256:80887626208cbb3659a436e6e26c56f0b0229f0bcb8d292de51738ee99ed11d1",
      "0007_work_item_gate_deaths": "sha256:95ac3c0dfeef6f6e6d4bd8b92473d19aabae0c83ebc3b1f4409d84fc0bbfa11c",
      "0011_workflow_run_provenance": "sha256:5011c78d0d2cbf3fbcc601ce2bdea4a39cdde21cb9df931ca5c9c1dc3cd7e5b6",
      "0012_loop_labels": "sha256:d2fa64d1ff97fc9225667e9e6045bbbae13acca2fad74ca79ecbc6bcf20f1521",
      "0008_tenant_prepare": "sha256:76924f61f71fa2e7d3fb7773ff372200e26d0b3e48a5d05585adaeeca8f30043",
      "0009_tenant_backfill": "sha256:7bfd222e503736ec0bc2811f8a31d3e57820a0fa1106795e09fd26a5cf966f2c",
      "0010_tenant_enforce": "sha256:f923c70c2960e0372b4c01c5f01d9432fa0c76b24921c616dc149fa191409053",
      "0013_loop_mutation_contract": "sha256:eb35e8d593628f2d7a2449dddf60b28e6ffc42f87ff694441262aa2794e78913",
      "0014_loops_identity_aliases": "sha256:9e73cf54d084709bf08f4a74dc1d5900a647cd574acb958503e5b50b8122e792",
      "0014_loop_expires_after_runs": "sha256:4c60d6c900c2f3146bd20da3bc3665a0a40e1b7e145433d8944d663da57460d7",
      "0015_run_receipts_loop_cascade": "sha256:ac4ebc03cdf15383a7fd2f6ad12253cee4ddf68011b9d65c22e15d85693d3492",
    };
    for (const migration of POSTGRES_STORAGE_MIGRATIONS) {
      expect(`${migration.id} ${migration.checksum}`).toBe(`${migration.id} ${pinned[migration.id]}`);
    }
    // route_scope lives ONLY in the additive 0004 migration, never in a
    // released block.
    for (const migration of POSTGRES_STORAGE_MIGRATIONS) {
      if (migration.id === "0004_work_item_route_scope") {
        expect(migration.sql).toContain("ADD COLUMN IF NOT EXISTS route_scope");
        expect(migration.sql).toContain("idx_workflow_work_items_scope");
      } else if (migration.id === "0006_work_item_machine_id") {
        expect(migration.sql).toContain("ADD COLUMN IF NOT EXISTS machine_id");
        expect(migration.sql).toContain("idx_workflow_work_items_machine");
      } else {
        expect(migration.sql).not.toContain("route_scope");
        if (migration.id === "0002_workflows_goals") {
          expect(migration.sql).not.toContain("machine_id TEXT");
          expect(migration.sql).not.toContain("idx_workflow_work_items_machine");
        }
      }
    }
  });

  test("plans and applies pending migrations through the checksum ledger", async () => {
    const executor = new FakePostgresExecutor();
    const storage = new PostgresStorage(executor);

    const dryRun = await storage.migrate({ dryRun: true });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.plan.every((item) => item.state === "pending")).toBe(true);
    expect(executor.executed).toHaveLength(0);

    const result = await storage.migrate();
    expect(result.dryRun).toBe(false);
    expect(result.applied.map((migration) => migration.id)).toEqual(POSTGRES_STORAGE_MIGRATIONS.map((migration) => migration.id));
    expect(executor.executed[0]?.sql).toContain(POSTGRES_MIGRATION_LEDGER_TABLE);
    expect(executor.executed.filter((entry) => entry.sql.startsWith("INSERT INTO"))).toHaveLength(POSTGRES_STORAGE_MIGRATIONS.length);
    expect(executor.queried[1]).toBe(POSTGRES_MIGRATION_ADVISORY_LOCK_SQL);
    expect(executor.queried[2]).toContain(POSTGRES_MIGRATION_LEDGER_TABLE);

    const second = await storage.migrate();
    expect(second.plan.every((item) => item.state === "already_applied")).toBe(true);
  });

  test("dry-run reads the ledger and reports already-applied migrations", async () => {
    const executor = new FakePostgresExecutor();
    executor.ledger = [
      {
        id: POSTGRES_STORAGE_MIGRATIONS[0]!.id,
        checksum: POSTGRES_STORAGE_MIGRATIONS[0]!.checksum,
        applied_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const storage = new PostgresStorage(executor);

    const dryRun = await storage.migrate({ dryRun: true });

    expect(executor.executed).toHaveLength(0);
    expect(dryRun.applied.map((migration) => migration.id)).toEqual([POSTGRES_STORAGE_MIGRATIONS[0]!.id]);
    expect(dryRun.plan[0]?.state).toBe("already_applied");
    expect(dryRun.plan.slice(1).every((item) => item.state === "pending")).toBe(true);
  });

  test("existing pre-route_scope database upgrades by applying only later additive migrations", async () => {
    // The realistic upgrade: a deployment whose ledger recorded 0001-0003 with
    // the released checksums. Verification must pass (no released SQL was
    // edited) and only later additive migrations may execute. This is the pg
    // twin of the sqlite pre-0008 fixture test: route_scope briefly lived
    // inside the checksummed 0002 block, which would have failed this exact
    // scenario with a checksum mismatch.
    const executor = new FakePostgresExecutor();
    executor.ledger = POSTGRES_STORAGE_MIGRATIONS.slice(0, 3).map((migration) => ({
      id: migration.id,
      checksum: migration.checksum,
      applied_at: "2026-01-01T00:00:00.000Z",
    }));
    const storage = new PostgresStorage(executor);

    const result = await storage.migrate({ through: "0007_work_item_gate_deaths" });

    const executedSql = executor.executed.filter((entry) => !entry.sql.startsWith("INSERT INTO") && !entry.sql.includes("CREATE TABLE IF NOT EXISTS open_loops_schema_migrations"));
    expect(executedSql).toHaveLength(4);
    expect(executedSql[0]!.sql).toContain("ADD COLUMN IF NOT EXISTS route_scope");
    expect(executedSql[1]!.sql).toContain("CREATE TABLE IF NOT EXISTS run_receipts");
    expect(executedSql[2]!.sql).toContain("ADD COLUMN IF NOT EXISTS machine_id");
    expect(executedSql[3]!.sql).toContain("ADD COLUMN IF NOT EXISTS gate_deaths");
    expect(result.applied.map((migration) => migration.id)).toEqual(POSTGRES_STORAGE_MIGRATIONS.slice(0, 7).map((migration) => migration.id));
  });

  test("tenant preparation can stop before explicit backfill and enforcement", async () => {
    const executor = new FakePostgresExecutor();
    const storage = new PostgresStorage(executor);

    const result = await storage.migrate({ through: "0008_tenant_prepare" });

    expect(result.applied.at(-1)?.id).toBe("0008_tenant_prepare");
    expect(result.applied.some((migration) => migration.id === "0009_tenant_backfill")).toBe(false);
    expect(executor.executed.some((entry) => entry.sql.includes("tenant_row_assignments"))).toBe(true);
    expect(executor.executed.some((entry) => entry.sql.includes("tenant backfill incomplete"))).toBe(false);
  });

  test("dry-run fails closed when an applied migration checksum changes", async () => {
    const executor = new FakePostgresExecutor();
    executor.ledger = [
      {
        id: POSTGRES_STORAGE_MIGRATIONS[0]!.id,
        checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        applied_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const storage = new PostgresStorage(executor);

    await expect(storage.migrate({ dryRun: true })).rejects.toThrow("Postgres migration checksum mismatch");
    expect(executor.executed).toHaveLength(0);
  });

  test("fails closed when the ledger contains an unknown future migration", async () => {
    const executor = new FakePostgresExecutor();
    executor.ledger = [
      ...POSTGRES_STORAGE_MIGRATIONS.map((migration) => ({
        id: migration.id,
        checksum: migration.checksum,
        applied_at: "2026-01-01T00:00:00.000Z",
      })),
      {
        id: "9999_future_migration",
        checksum: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        applied_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const storage = new PostgresStorage(executor);

    await expect(storage.migrate({ dryRun: true })).rejects.toThrow("not recognized by this binary");
    await expect(storage.migrate()).rejects.toThrow("not recognized by this binary");
  });

  test("fails closed when an applied migration checksum changes", async () => {
    const executor = new FakePostgresExecutor();
    executor.ledger = [
      {
        id: POSTGRES_STORAGE_MIGRATIONS[0]!.id,
        checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        applied_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const storage = new PostgresStorage(executor);

    await expect(storage.migrate()).rejects.toThrow("Postgres migration checksum mismatch");
  });

  test("loop mutation advisory lock SQL is valid PostgreSQL text (no NUL byte or NUL escape)", () => {
    // O15-00692 regression: the lock query previously used E'\000' — an octal
    // escape for NUL in a Postgres E-string. PostgreSQL rejects NUL bytes in
    // text ("invalid byte sequence for encoding UTF8: 0x00"), so the first
    // statement of every mutation transaction threw and
    // POST /v1/loops/<id>/mutations returned 500 for every loop.
    expect(LOOP_MUTATION_ADVISORY_LOCK_SQL.includes("\0")).toBe(false);
    expect(LOOP_MUTATION_ADVISORY_LOCK_SQL).not.toMatch(/E'\\x?0{1,2}'/);
    // The separator must be present so the three ids are joined deterministically.
    expect(LOOP_MUTATION_ADVISORY_LOCK_SQL).toContain("E'\\x1f'");
    expect(LOOP_MUTATION_ADVISORY_LOCK_SQL).toMatch(/open_loops_current_tenant_id\(\)/);
  });
});
