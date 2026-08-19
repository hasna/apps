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
    expect(ids).toContain("projects:0004_guarded_project_mutation_runtime_grants");
    expect(ids).toContain("projects:0006_project_resource_links");
    expect(ids).toContain("projects:0007_conversations_channel_locator");
    expect(ids).toContain("projects:0008_orgs_resource_links");
    expect(ids).toContain("projects:0009_contacts_resource_links");
    expect(ids).toContain("projects:0009_todos_task_resource_links");
    expect(ids).toContain("projects:0010_project_resource_link_contract_v1");
    expect(ids).toContain("projects:0011_machine_ownership_runtime_grants");
  });

  test("machine ownership runtime grant follows the hosted workspaces DML role", () => {
    const migration = loadMigrations().find(
      (item) => item.id === "projects:0011_machine_ownership_runtime_grants",
    );
    expect(migration).toBeDefined();
    expect(migration!.sql).toContain("relation.relname = 'workspaces'");
    expect(migration!.sql).toContain("COUNT(DISTINCT privilege.privilege_type) = 4");
    expect(migration!.sql.match(/'GRANT [^']+'/g)).toEqual([
      "'GRANT SELECT ON TABLE %I.%I TO %I'",
    ]);
    expect(migration!.sql).not.toContain("projects_app");
  });

  test("guarded receipt grant migration derives existing DML roles and grants only receipt reads and inserts", () => {
    const migration = loadMigrations().find(
      (item) => item.id === "projects:0004_guarded_project_mutation_runtime_grants",
    );
    expect(migration).toBeDefined();
    expect(migration!.sql).toContain("relation.relname = 'workspaces'");
    expect(migration!.sql).toContain("COUNT(DISTINCT privilege.privilege_type) = 4");
    expect(migration!.sql.match(/'GRANT [^']+'/g)).toEqual([
      "'GRANT SELECT, INSERT ON TABLE %I.%I TO %I'",
    ]);
    expect(migration!.sql).not.toContain("projects_app");
  });

  test("typed resource-link migration closes identity, immutability, and runtime grants", () => {
    const migration = loadMigrations().find(
      (item) => item.id === "projects:0006_project_resource_links",
    );
    expect(migration).toBeDefined();
    expect(migration!.sql).toContain("CREATE TABLE IF NOT EXISTS project_resource_links");
    expect(migration!.sql).toContain("UNIQUE(project_id, authority, service_instance, source_package, target_kind, locator_kind, locator_value)");
    expect(migration!.sql).toContain("project resource link identity is immutable");
    expect(migration!.sql).toContain("COUNT(DISTINCT privilege.privilege_type) = 4");
    expect(migration!.sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE");
    expect(migration!.sql).not.toContain("projects_app");
  });

  test("channel locator migration widens only the closed locator-kind constraint", () => {
    const migration = loadMigrations().find(
      (item) => item.id === "projects:0007_conversations_channel_locator",
    );
    expect(migration).toBeDefined();
    expect(migration!.sql).toContain(
      "DROP CONSTRAINT IF EXISTS project_resource_links_locator_kind_check",
    );
    expect(migration!.sql).toContain(
      "CHECK(locator_kind IN ('external_uuid', 'canonical_uri', 'conversations_channel_id'))",
    );
    expect(migration!.sql).not.toContain("DROP TABLE");
    expect(migration!.sql).not.toContain("DELETE FROM");
  });

  test("Orgs resource-link migration widens only the closed authority, package, and target constraints", () => {
    const migration = loadMigrations().find(
      (item) => item.id === "projects:0008_orgs_resource_links",
    );
    expect(migration).toBeDefined();
    expect(migration!.sql).toContain("'orgs'");
    expect(migration!.sql).toContain("'@hasna/orgs'");
    expect(migration!.sql).toContain("'org'");
    expect(migration!.sql).not.toContain("DROP TABLE");
    expect(migration!.sql).not.toContain("DELETE FROM");
  });

  test("Contacts resource-link migration widens only the closed authority, package, and target constraints", () => {
    const migration = loadMigrations().find(
      (item) => item.id === "projects:0009_contacts_resource_links",
    );
    expect(migration).toBeDefined();
    expect(migration!.sql).toContain("'contacts'");
    expect(migration!.sql).toContain("'@hasna/contacts'");
    expect(migration!.sql).toContain("'contact'");
    expect(migration!.sql).not.toContain("DROP TABLE");
    expect(migration!.sql).not.toContain("DELETE FROM");
  });

  test("Todos task resource-link migration widens only the closed target-kind constraint", () => {
    const migration = loadMigrations().find(
      (item) => item.id === "projects:0009_todos_task_resource_links",
    );
    expect(migration).toBeDefined();
    expect(migration!.sql).toContain(
      "DROP CONSTRAINT IF EXISTS project_resource_links_target_kind_check",
    );
    expect(migration!.sql).toContain("'contact'");
    expect(migration!.sql).toContain("'task'");
    expect(migration!.sql).not.toContain("project_resource_links_authority_check");
    expect(migration!.sql).not.toContain("project_resource_links_source_package_check");
    expect(migration!.sql).not.toContain("DROP TABLE");
    expect(migration!.sql).not.toContain("DELETE FROM");
  });

  test("resource-link contract v1 keeps scope mutable and persists an append-only migration saga", () => {
    const migration = loadMigrations().find(
      (item) => item.id === "projects:0010_project_resource_link_contract_v1",
    );
    expect(migration).toBeDefined();
    expect(migration!.sql).toContain("CREATE TABLE IF NOT EXISTS project_resource_link_migration_manifests");
    expect(migration!.sql).toContain("CREATE TABLE IF NOT EXISTS project_resource_link_migration_events");
    expect(migration!.sql).toContain("project resource link migration events are append-only");
    expect(migration!.sql).toContain("UNIQUE(project_id, operation_id, step_id)");
    expect(migration!.sql).toContain("UNIQUE(manifest_id, transition_version)");
    expect(migration!.sql).toContain("COUNT(DISTINCT privilege.privilege_type) = 4");
    expect(migration!.sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE");
    const identityFunction = migration!.sql.slice(
      migration!.sql.indexOf("CREATE OR REPLACE FUNCTION reject_project_resource_link_identity_mutation"),
      migration!.sql.indexOf("CREATE TABLE IF NOT EXISTS project_resource_link_migration_manifests"),
    );
    expect(identityFunction).not.toContain("NEW.scope");
    expect(identityFunction).not.toContain("OLD.scope");
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
