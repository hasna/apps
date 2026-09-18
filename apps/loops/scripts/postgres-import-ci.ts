/**
 * Required live-PostgreSQL proof for the Loops import transaction boundary.
 *
 * This file deliberately does not use the *.test.ts suffix, so the hermetic
 * default suite does not discover it. Root CI invokes it explicitly with a
 * disposable PostgreSQL 16 service and a mandatory URL; missing or unexpected
 * authority fails closed instead of turning these proofs into skipped tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PgPoolExecutor } from "../src/lib/storage/pg-executor.js";
import { PostgresLoopStorage } from "../src/lib/storage/postgres-loop-storage.js";
import { PostgresStorage } from "../src/lib/storage/postgres.js";
import type { LoopRun, WorkflowSpec } from "../src/types.js";

const DATABASE_URL = process.env.LOOPS_IMPORT_CI_DATABASE_URL;
if (!DATABASE_URL) throw new Error("LOOPS_IMPORT_CI_DATABASE_URL is required; live import proofs must not skip");
const parsed = new URL(DATABASE_URL);
const expectedPort = process.env.LOOPS_IMPORT_CI_EXPECTED_PORT ?? "5432";
if (
  parsed.protocol !== "postgres:" ||
  parsed.hostname !== "127.0.0.1" ||
  parsed.port !== expectedPort ||
  parsed.pathname !== "/loops_import_ci" ||
  parsed.username !== "postgres" ||
  parsed.password ||
  parsed.search ||
  parsed.hash
) {
  throw new Error("Refusing non-disposable PostgreSQL authority for Loops import CI proof");
}

const executor = PgPoolExecutor.fromConnectionString({
  connectionString: DATABASE_URL,
  applicationName: "loops-import-required-ci",
});
const schema = new PostgresStorage(executor);
const storage = new PostgresLoopStorage(executor.queryClient, {
  tenantId: "loops-import-ci",
  principalId: "loops-import-ci",
  requestId: "loops-import-ci",
});

function workflow(id: string): WorkflowSpec {
  return {
    id,
    name: id,
    version: 1,
    status: "active",
    steps: [{ id: "step", target: { type: "command", command: "true" } }],
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
  };
}

describe("required live PostgreSQL import integrity", () => {
  beforeAll(async () => {
    await schema.migrate();
    await executor.queryClient.execute(`
      INSERT INTO tenants(id, slug, name, status)
      VALUES ('loops-import-ci', 'loops-import-ci', 'Loops Import CI', 'active');
      INSERT INTO principals(id, kind, display_name, status)
      VALUES ('loops-import-ci', 'service', 'Loops Import CI', 'active');
      INSERT INTO tenant_memberships(tenant_id, principal_id, status)
      VALUES ('loops-import-ci', 'loops-import-ci', 'active');
      INSERT INTO tenant_membership_roles(tenant_id, principal_id, role)
      VALUES ('loops-import-ci', 'loops-import-ci', 'service');
    `);
  });

  beforeEach(async () => {
    await executor.queryClient.execute(
      "TRUNCATE loops, loop_runs, workflow_specs RESTART IDENTITY CASCADE",
    );
  });

  afterAll(async () => {
    await executor.close();
  });

  test("orphan run preflight rejects before any PostgreSQL write", async () => {
    const first = workflow("pg-before-orphan");
    const orphan: LoopRun = {
      id: "pg-orphan-run",
      loopId: "missing-pg-loop",
      loopName: "missing-pg-loop",
      scheduledFor: "2026-09-18T00:00:00.000Z",
      attempt: 1,
      status: "succeeded",
      finishedAt: "2026-09-18T00:00:01.000Z",
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:01.000Z",
    };
    await expect(storage.importMigrationRows({ workflows: [first], loops: [], runs: [orphan] }))
      .rejects.toMatchObject({ code: "MIGRATION_IMPORT_INVALID" });
    expect(await storage.getWorkflow(first.id)).toBeUndefined();
    expect(await storage.countRuns()).toBe(0);
  });

  test("a later PostgreSQL write failure rolls every earlier import row back", async () => {
    await executor.queryClient.execute(`
      CREATE OR REPLACE FUNCTION loops_import_ci_fail_write() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = 'pg-forced-failure' THEN
          RAISE EXCEPTION 'forced postgres migration rollback';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER loops_import_ci_fail_write
      BEFORE INSERT OR UPDATE ON workflow_specs
      FOR EACH ROW EXECUTE FUNCTION loops_import_ci_fail_write();
    `);
    const first = workflow("pg-rollback-first");
    const failing = workflow("pg-forced-failure");
    try {
      await expect(storage.importMigrationRows({
        workflows: [first, failing],
        loops: [],
        runs: [],
        replace: true,
      })).rejects.toThrow("forced postgres migration rollback");
      expect(await storage.getWorkflow(first.id)).toBeUndefined();
      expect(await storage.getWorkflow(failing.id)).toBeUndefined();
    } finally {
      await executor.queryClient.execute("DROP TRIGGER IF EXISTS loops_import_ci_fail_write ON workflow_specs");
      await executor.queryClient.execute("DROP FUNCTION IF EXISTS loops_import_ci_fail_write()");
    }
  });

  afterAll(() => {
    console.log("[loops-live-postgres] PASS: orphan preflight and forced rollback executed");
  });
});
