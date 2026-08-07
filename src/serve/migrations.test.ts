import { describe, expect, test } from "bun:test";
import type { QueryResultRow } from "pg";
import {
  defineMigration,
  type AppliedMigration,
} from "../generated/storage-kit/index.js";
import type {
  QueryResult,
  TypedQueryClient,
} from "../generated/storage-kit/query.js";
import {
  assertMigrationCompatibility,
  loadMigrations,
  PROJECTS_APPLIED_MIGRATION_COMPATIBILITY,
  resolveMigrationsDir,
  runMigrationLedgerWithCompatibility,
} from "./migrations.js";

function createMigrationClient(initialApplied: readonly AppliedMigration[] = []): {
  client: TypedQueryClient;
  executedMigrationSql: string[];
  insertedMigrationIds: string[];
  ledgerRows: AppliedMigration[];
} {
  const ledgerRows = initialApplied.map((row) => ({ ...row }));
  const executedMigrationSql: string[] = [];
  const insertedMigrationIds: string[] = [];

  const client: TypedQueryClient = {
    async query<T extends QueryResultRow>(): Promise<QueryResult<T>> {
      throw new Error("Unexpected query() call in migration test.");
    },
    async many<T extends QueryResultRow>(sql: string): Promise<T[]> {
      if (!/SELECT id, checksum, applied_at FROM schema_migrations/.test(sql)) {
        throw new Error(`Unexpected many() SQL in migration test: ${sql}`);
      }
      return ledgerRows.map((row) => ({
        id: row.id,
        checksum: row.checksum,
        applied_at: row.appliedAt,
      })) as unknown as T[];
    },
    async get<T extends QueryResultRow>(): Promise<T | null> {
      throw new Error("Unexpected get() call in migration test.");
    },
    async one<T extends QueryResultRow>(): Promise<T> {
      throw new Error("Unexpected one() call in migration test.");
    },
    async execute(sql: string, params?: readonly unknown[]): Promise<void> {
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)) return;
      if (/INSERT INTO schema_migrations/.test(sql)) {
        const id = String(params?.[0]);
        const checksum = String(params?.[1]);
        insertedMigrationIds.push(id);
        ledgerRows.push({
          id,
          checksum,
          appliedAt: "2026-08-07T00:00:00.000Z",
        });
        return;
      }
      executedMigrationSql.push(sql);
    },
  };

  return { client, executedMigrationSql, insertedMigrationIds, ledgerRows };
}

describe("projects-serve migrations", () => {
  test("resolves the on-disk migrations directory", () => {
    const dir = resolveMigrationsDir();
    expect(dir).toContain("migrations");
  });

  test("loads baseline schema + api-keys migrations with unique ids", () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    const ids = migrations.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith("projects:0001_baseline"))).toBe(true);
    // The api-keys table migration comes from @hasna/contracts/auth.
    expect(migrations.some((m) => /api_key/i.test(m.sql))).toBe(true);
    // Baseline creates the core workspaces table.
    expect(migrations.some((m) => /CREATE TABLE IF NOT EXISTS workspaces/i.test(m.sql))).toBe(true);
  });

  test("every migration has a sha256 checksum", () => {
    for (const m of loadMigrations()) {
      expect(m.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  test("accepts the exact legacy id and checksum as applied-only compatibility", async () => {
    const migration = defineMigration("projects:current", "SELECT current");
    const legacy: AppliedMigration = {
      ...PROJECTS_APPLIED_MIGRATION_COMPATIBILITY[0],
      appliedAt: "2026-07-13T00:00:00.000Z",
    };
    const harness = createMigrationClient([legacy]);

    const result = await runMigrationLedgerWithCompatibility(
      harness.client,
      [migration],
      PROJECTS_APPLIED_MIGRATION_COMPATIBILITY,
      { dryRun: true },
    );

    expect(result.applied).toEqual([legacy]);
    expect(result.plan.map((item) => [item.migration.id, item.state])).toEqual([
      [migration.id, "pending"],
    ]);
    expect(harness.executedMigrationSql).toEqual([]);
    expect(harness.insertedMigrationIds).toEqual([]);
  });

  test("rejects the legacy id with any other checksum", async () => {
    const legacy = PROJECTS_APPLIED_MIGRATION_COMPATIBILITY[0];
    const harness = createMigrationClient([{
      id: legacy.id,
      checksum: "sha256:wrong",
      appliedAt: "2026-07-13T00:00:00.000Z",
    }]);

    await expect(runMigrationLedgerWithCompatibility(
      harness.client,
      [defineMigration("projects:current", "SELECT current")],
      PROJECTS_APPLIED_MIGRATION_COMPATIBILITY,
    )).rejects.toThrow(
      `Migration checksum mismatch for '${legacy.id}': applied 'sha256:wrong', expected '${legacy.checksum}'.`,
    );
  });

  test("rejects unknown applied migrations", async () => {
    const harness = createMigrationClient([{
      id: "projects:unknown",
      checksum: "sha256:unknown",
      appliedAt: "2026-07-13T00:00:00.000Z",
    }]);

    await expect(runMigrationLedgerWithCompatibility(
      harness.client,
      [defineMigration("projects:current", "SELECT current")],
      PROJECTS_APPLIED_MIGRATION_COMPATIBILITY,
    )).rejects.toThrow(
      "Applied migration 'projects:unknown' (checksum 'sha256:unknown') is not recognized by this build (downgrade?).",
    );
  });

  test("current migrations still plan and apply normally", async () => {
    const first = defineMigration("projects:current-1", "SELECT current_1");
    const second = defineMigration("projects:current-2", "SELECT current_2");
    const legacy: AppliedMigration = {
      ...PROJECTS_APPLIED_MIGRATION_COMPATIBILITY[0],
      appliedAt: "2026-07-13T00:00:00.000Z",
    };
    const harness = createMigrationClient([
      legacy,
      {
        id: first.id,
        checksum: first.checksum,
        appliedAt: "2026-08-06T00:00:00.000Z",
      },
    ]);

    const result = await runMigrationLedgerWithCompatibility(
      harness.client,
      [first, second],
      PROJECTS_APPLIED_MIGRATION_COMPATIBILITY,
    );

    expect(result.plan.map((item) => [item.migration.id, item.state])).toEqual([
      [first.id, "already_applied"],
      [second.id, "pending"],
    ]);
    expect(harness.executedMigrationSql).toEqual([second.sql]);
    expect(harness.insertedMigrationIds).toEqual([second.id]);
    expect(harness.ledgerRows.map((row) => row.id)).toEqual([
      legacy.id,
      first.id,
      second.id,
    ]);
  });

  test("fresh databases apply only current migrations", async () => {
    const first = defineMigration("projects:current-1", "SELECT current_1");
    const second = defineMigration("projects:current-2", "SELECT current_2");
    const harness = createMigrationClient();

    const result = await runMigrationLedgerWithCompatibility(
      harness.client,
      [first, second],
      PROJECTS_APPLIED_MIGRATION_COMPATIBILITY,
    );

    expect(result.plan.map((item) => [item.migration.id, item.state])).toEqual([
      [first.id, "pending"],
      [second.id, "pending"],
    ]);
    expect(harness.executedMigrationSql).toEqual([first.sql, second.sql]);
    expect(harness.insertedMigrationIds).toEqual([first.id, second.id]);
    expect(harness.insertedMigrationIds).not.toContain(
      PROJECTS_APPLIED_MIGRATION_COMPATIBILITY[0].id,
    );
  });

  test("checksum drift reports applied and expected checksums without accepting it", () => {
    const migration = defineMigration("projects:0001_baseline", "SELECT 1");
    const applied: AppliedMigration[] = [{
      id: migration.id,
      checksum: "sha256:changed",
      appliedAt: "2026-07-13T00:00:00.000Z",
    }];

    expect(() => assertMigrationCompatibility([migration], applied))
      .toThrow(
        `Migration checksum mismatch for '${migration.id}': applied 'sha256:changed', expected '${migration.checksum}'.`,
      );
  });
});
