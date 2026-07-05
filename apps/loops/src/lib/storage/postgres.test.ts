import { describe, expect, test } from "bun:test";
import { PostgresStorage } from "./postgres.js";
import { POSTGRES_MIGRATION_LEDGER_TABLE, POSTGRES_STORAGE_MIGRATIONS, checksumStorageSql } from "./postgres-schema.js";
import type { PostgresQueryExecutor } from "./postgres.js";

class FakePostgresExecutor implements PostgresQueryExecutor {
  readonly executed: Array<{ sql: string; params?: readonly unknown[] }> = [];
  ledger: Array<{ id: string; checksum: string; applied_at: string }> = [];

  async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
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

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

describe("Postgres storage migrations", () => {
  test("define a checksum-ledgered schema for core runtime, runners, and audit rows", () => {
    expect(POSTGRES_STORAGE_MIGRATIONS.map((migration) => migration.id)).toEqual([
      "0001_core_runtime",
      "0002_workflows_goals",
      "0003_remote_runners_and_audit",
      "0004_work_item_route_scope",
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
  });

  test("released migration SQL is immutable — pinned checksums never change", () => {
    // Editing an already-released migration's SQL (instead of adding a new
    // additive migration) breaks every existing database: migrate() fails
    // closed with "checksum mismatch" because the ledger recorded the original
    // checksum. This pins the released checksums so that defect class fails
    // here first. When adding schema, append a NEW migration and pin it below —
    // never touch a released block. (Regression: route_scope was briefly folded
    // into 0002_workflows_goals, which would have bricked upgrades of every
    // existing postgres deployment.)
    const pinned: Record<string, string> = {
      "0001_core_runtime": "sha256:99cab06c75144cbcd3076ea42132fe511fe0f8c89d1c96bdcc4abef7c026ef32",
      "0002_workflows_goals": "sha256:cf9d74beafadaf97dcb26c3d584caa634265fb99978704417886c58d1f804b42",
      "0003_remote_runners_and_audit": "sha256:9f0816668315c08aefeda1afebb58ad74e803d6dd1bca580e0697f602486c520",
      "0004_work_item_route_scope": "sha256:341e439861d595ce3d069b0106f1f09134042bac0a70f3d00a1374e09f5404d9",
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
      } else {
        expect(migration.sql).not.toContain("route_scope");
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
    expect(dryRun.plan.map((item) => item.state)).toEqual(["already_applied", "pending", "pending", "pending"]);
  });

  test("existing pre-route_scope database upgrades by applying only the additive 0004 migration", async () => {
    // The realistic upgrade: a deployment whose ledger recorded 0001-0003 with
    // the released checksums. Verification must pass (no released SQL was
    // edited) and only 0004_work_item_route_scope may execute. This is the pg
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

    const result = await storage.migrate();

    const executedSql = executor.executed.filter((entry) => !entry.sql.startsWith("INSERT INTO") && !entry.sql.includes("CREATE TABLE IF NOT EXISTS open_loops_schema_migrations"));
    expect(executedSql).toHaveLength(1);
    expect(executedSql[0]!.sql).toContain("ADD COLUMN IF NOT EXISTS route_scope");
    expect(result.applied.map((migration) => migration.id)).toEqual(POSTGRES_STORAGE_MIGRATIONS.map((migration) => migration.id));
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
});
