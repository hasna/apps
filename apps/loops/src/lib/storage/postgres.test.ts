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
    ]);
    for (const migration of POSTGRES_STORAGE_MIGRATIONS) {
      expect(migration.checksum).toBe(checksumStorageSql(migration.sql));
      expect(migration.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    const combined = POSTGRES_STORAGE_MIGRATIONS.map((migration) => migration.sql).join("\n");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS loops");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS loop_runs");
    expect(combined).toContain("UNIQUE(loop_id, scheduled_for, fanout_key)");
    expect(combined).toContain("idx_runs_machine");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS workflow_runs");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS runner_machines");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS runner_leases");
    expect(combined).toContain("idx_runner_leases_active_loop_run");
    expect(combined).toContain("CREATE TABLE IF NOT EXISTS audit_events");
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
    expect(dryRun.plan.map((item) => item.state)).toEqual(["already_applied", "pending", "pending"]);
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
