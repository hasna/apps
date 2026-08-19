import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createPgPool, createQueryClient } from "../generated/storage-kit/index.js";
import { loadMigrations, runProjectsMigrations } from "./migrations.js";
import { ProjectsPgStore } from "./pg-store.js";

const ADMIN_URL = process.env.PROJECTS_TEST_ADMIN_DATABASE_URL;
const describePostgres = ADMIN_URL ? describe : describe.skip;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function roleConnectionString(baseUrl: string, role: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c role=${role} -c search_path=${schema}`);
  return url.toString();
}

describePostgres("pg-store guarded mutation runtime role", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const ownerRole = `projects_test_owner_${suffix}`;
  const runtimeRole = `projects_test_runtime_${suffix}`;
  const readOnlyRole = `projects_test_readonly_${suffix}`;
  const schema = `projects_test_${suffix}`;
  const workspaceId = `wks_guardedpg${suffix}`;
  const migrationsDir = join(import.meta.dir, "..", "..", "migrations");

  const adminPool = ADMIN_URL
    ? createPgPool({ connectionString: ADMIN_URL, applicationName: "projects-test-admin", max: 1 })
    : null;
  const admin = adminPool ? createQueryClient(adminPool) : null;
  let ownerPool: ReturnType<typeof createPgPool> | null = null;
  let runtimePool: ReturnType<typeof createPgPool> | null = null;
  let owner: ReturnType<typeof createQueryClient> | null = null;
  let runtime: ReturnType<typeof createQueryClient> | null = null;

  beforeAll(async () => {
    if (!ADMIN_URL || !admin) return;
    await admin.execute(`CREATE ROLE ${quoteIdentifier(ownerRole)} NOLOGIN NOINHERIT`);
    await admin.execute(`CREATE ROLE ${quoteIdentifier(runtimeRole)} NOLOGIN NOINHERIT`);
    await admin.execute(`CREATE ROLE ${quoteIdentifier(readOnlyRole)} NOLOGIN NOINHERIT`);
    await admin.execute(
      `CREATE SCHEMA ${quoteIdentifier(schema)} AUTHORIZATION ${quoteIdentifier(ownerRole)}`,
    );

    ownerPool = createPgPool({
      connectionString: roleConnectionString(ADMIN_URL, ownerRole, schema),
      applicationName: "projects-test-owner",
      max: 2,
    });
    owner = createQueryClient(ownerPool);
    runtimePool = createPgPool({
      connectionString: roleConnectionString(ADMIN_URL, runtimeRole, schema),
      applicationName: "projects-test-runtime",
      max: 2,
    });
    runtime = createQueryClient(runtimePool);

    await owner.execute(readFileSync(join(migrationsDir, "0001_baseline.sql"), "utf8"));
    await owner.execute(readFileSync(join(migrationsDir, "0002_machine_ownership.sql"), "utf8"));
    await owner.execute(`GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(runtimeRole)}`);
    await owner.execute(`GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(readOnlyRole)}`);
    await owner.execute(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(runtimeRole)}`,
    );
    await owner.execute(
      `REVOKE ALL ON TABLE machines FROM ${quoteIdentifier(runtimeRole)}`,
    );
    await owner.execute(
      `GRANT SELECT ON TABLE workspaces TO ${quoteIdentifier(readOnlyRole)}`,
    );
    await owner.execute(
      readFileSync(join(migrationsDir, "0003_guarded_project_mutation_receipts.sql"), "utf8"),
    );
    await owner.execute(
      `CREATE TABLE schema_migrations (
         id TEXT PRIMARY KEY,
         checksum TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    for (const migration of loadMigrations().filter((item) =>
      /^projects:000[1-3]_/.test(item.id)
    )) {
      await owner.execute(
        "INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)",
        [migration.id, migration.checksum],
      );
    }
    await owner.execute(
      `INSERT INTO agents (id, slug, name, kind) VALUES ($1, $2, $3, $4)`,
      ["cassianus", `cassianus-${suffix}`, "Cassianus", "ai"],
    );
    await owner.execute(
      `INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, $3)`,
      [workspaceId, `guarded-pg-${suffix}`, "Guarded Postgres"],
    );
  });

  afterAll(async () => {
    await runtime?.close();
    await owner?.close();
    if (admin) {
      await admin.execute(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await admin.execute(`DROP ROLE IF EXISTS ${quoteIdentifier(runtimeRole)}`);
      await admin.execute(`DROP ROLE IF EXISTS ${quoteIdentifier(readOnlyRole)}`);
      await admin.execute(`DROP ROLE IF EXISTS ${quoteIdentifier(ownerRole)}`);
      await admin.close();
    }
  });

  test("repairs the measured machine and receipt ACLs without widening runtime privileges", async () => {
    if (!owner || !runtime) throw new Error("Postgres test clients were not initialized");
    const store = new ProjectsPgStore(runtime);
    const initial = await store.getWorkspace(workspaceId);
    expect(initial).not.toBeNull();

    await expect(store.updateWorkspace(workspaceId, { canonical_machine: "spark02" }))
      .rejects.toMatchObject({ code: "42501" });
    expect(await store.getWorkspace(workspaceId)).toEqual(initial);

    const before = initial;

    const request = {
      project_id: workspaceId,
      operation_id: `project-rename-${suffix}`,
      step_id: "metadata-to-monthly-filing",
      expected_revision: before!.updated_at,
      patch: { name: "Monthly Filing", slug: `monthly-filing-${suffix}` },
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
      agent_id: "cassianus",
      source: "cli" as const,
      command: "projects guarded-update --dry-run",
    };

    await expect(store.guardedUpdateWorkspace({ ...request, dry_run: true }))
      .rejects.toMatchObject({ code: "42501" });
    expect((await store.getWorkspace(workspaceId))?.updated_at).toBe(before!.updated_at);

    const migrated = await runProjectsMigrations(owner);
    expect(migrated.plan.find((item) =>
      item.migration.id === "projects:0004_guarded_project_mutation_runtime_grants"
    )?.state).toBe("pending");
    expect(migrated.plan.find((item) =>
      item.migration.id === "projects:0011_machine_ownership_runtime_grants"
    )?.state).toBe("pending");
    const rerun = await runProjectsMigrations(owner);
    expect(rerun.plan.every((item) => item.state === "already_applied")).toBe(true);

    const privileges = await owner.one<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
    }>(
      `SELECT
         has_table_privilege($1, $2, 'SELECT') AS can_select,
         has_table_privilege($1, $2, 'INSERT') AS can_insert,
         has_table_privilege($1, $2, 'UPDATE') AS can_update,
         has_table_privilege($1, $2, 'DELETE') AS can_delete,
         has_table_privilege($1, $2, 'TRUNCATE') AS can_truncate`,
      [runtimeRole, `${schema}.guarded_project_mutation_receipts`],
    );
    expect(privileges).toEqual({
      can_select: true,
      can_insert: true,
      can_update: false,
      can_delete: false,
      can_truncate: false,
    });
    expect(await owner.one<{
      can_select: boolean;
      can_insert: boolean;
    }>(
      `SELECT
         has_table_privilege($1, $2, 'SELECT') AS can_select,
         has_table_privilege($1, $2, 'INSERT') AS can_insert`,
      [readOnlyRole, `${schema}.guarded_project_mutation_receipts`],
    )).toEqual({
      can_select: false,
      can_insert: false,
    });

    const dryRun = await store.guardedUpdateWorkspace({ ...request, dry_run: true });
    expect(dryRun.outcome).toBe("planned");
    expect(dryRun.receipt).toBeNull();
    expect(dryRun.response_control.complete).toBe(true);
    expect(dryRun.response_control.truncated).toBe(false);
    expect((await store.getWorkspace(workspaceId))?.updated_at).toBe(before!.updated_at);
    expect(await runtime.one<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM guarded_project_mutation_receipts",
    )).toEqual({ count: 0 });

    const accepted = await store.guardedUpdateWorkspace(request);
    expect(accepted.outcome).toBe("accepted");
    expect(accepted.receipt?.outcome).toBe("accepted");
    expect(accepted.after?.name).toBe("Monthly Filing");

    const duplicate = await store.guardedUpdateWorkspace(request);
    expect(duplicate.outcome).toBe("duplicate_of_accepted");
    expect(duplicate.receipt?.duplicate_of_receipt_id).toBe(accepted.receipt?.receipt_id);

    const rolledBack = await store.rollbackGuardedWorkspaceMutation({
      project_id: workspaceId,
      operation_id: `project-rename-rollback-${suffix}`,
      step_id: "restore-metadata",
      accepted_receipt_id: accepted.receipt!.receipt_id,
      expected_current_revision: accepted.receipt!.post_revision!,
      response_byte_limit: 16_384,
      time_budget_ms: 5_000,
      agent_id: "cassianus",
      source: "cli",
      command: "projects guarded-rollback",
    });
    expect(rolledBack.outcome).toBe("accepted");
    expect(rolledBack.receipt?.direction).toBe("inverse");
    expect(rolledBack.after?.name).toBe("Guarded Postgres");

    const beforeBudgetFailure = await store.getWorkspace(workspaceId);
    const receiptCountBeforeBudgetFailure = await runtime.one<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM guarded_project_mutation_receipts",
    );
    await expect(store.guardedUpdateWorkspace({
      ...request,
      operation_id: `project-rename-byte-limit-${suffix}`,
      expected_revision: beforeBudgetFailure!.updated_at,
      patch: { name: "Must Roll Back" },
      response_byte_limit: 10,
    })).rejects.toThrow(/response byte budget exceeded/);
    expect(await store.getWorkspace(workspaceId)).toEqual(beforeBudgetFailure);
    expect(await runtime.one<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM guarded_project_mutation_receipts",
    )).toEqual(receiptCountBeforeBudgetFailure);

    expect(await owner.one<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
    }>(
      `SELECT
         has_table_privilege($1, $2, 'SELECT') AS can_select,
         has_table_privilege($1, $2, 'INSERT') AS can_insert,
         has_table_privilege($1, $2, 'UPDATE') AS can_update,
         has_table_privilege($1, $2, 'DELETE') AS can_delete,
         has_table_privilege($1, $2, 'TRUNCATE') AS can_truncate`,
      [runtimeRole, `${schema}.machines`],
    )).toEqual({
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
      can_truncate: false,
    });

    const assigned = await store.updateWorkspace(workspaceId, { canonical_machine: "spark02" });
    expect(assigned.canonical_machine).toBe("spark02");
    const repeated = await store.updateWorkspace(workspaceId, { canonical_machine: "spark02" });
    expect(repeated.canonical_machine).toBe("spark02");

    const beforeInvalid = await store.getWorkspace(workspaceId);
    await expect(store.updateWorkspace(workspaceId, { canonical_machine: "not-a-machine" }))
      .rejects.toThrow("Machine not found: not-a-machine");
    expect(await store.getWorkspace(workspaceId)).toEqual(beforeInvalid);
  }, 30_000);
});
