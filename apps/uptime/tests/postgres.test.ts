import { expect, test } from "bun:test";
import {
  buildPostgresMigrationDryRun,
  renderPostgresMigrationRun,
  runPostgresMigration,
  type PostgresQueryClient,
} from "../src/postgres.js";

class FakePostgresClient implements PostgresQueryClient {
  readonly queries: Array<{ sql: string; params?: unknown[] }> = [];
  failOnSql?: string;

  constructor(
    private readonly existingTables: string[] = [],
    private readonly existingPolicies: string[] = [],
    private readonly existingIndexes: string[] = [],
  ) {}

  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    this.queries.push({ sql, params });
    if (this.failOnSql && sql.includes(this.failOnSql)) {
      throw new Error("migration failed with password=raw-secret and Bearer raw-token");
    }
    if (sql.includes("information_schema.tables")) {
      return {
        rowCount: this.existingTables.length,
        rows: this.existingTables.map((table_name) => ({ table_name })),
      };
    }
    if (sql.includes("pg_policies")) {
      return {
        rowCount: this.existingPolicies.length,
        rows: this.existingPolicies.map((policyname) => ({ policyname })),
      };
    }
    if (sql.includes("pg_indexes")) {
      return {
        rowCount: this.existingIndexes.length,
        rows: this.existingIndexes.map((indexname) => ({ indexname })),
      };
    }
    return { rows: [], rowCount: 0 };
  }
}

test("buildPostgresMigrationDryRun validates schema migrations without connecting", () => {
  const run = buildPostgresMigrationDryRun({
    databaseUrl: "postgres://svc:secret@db.example.invalid/uptime?sslmode=require",
  });
  const serialized = JSON.stringify(run);

  expect(run.kind).toBe("open-uptime.postgres-migration-run");
  expect(run.mode).toBe("dry-run");
  expect(run.status).toBe("planned");
  expect(run.database.redactedUrl).toBe("postgres://user:redacted@db.example.invalid/uptime");
  expect(run.migrationBlockers).toEqual([]);
  expect(run.runtimePromotionReady).toBe(false);
  expect(run.runtimeBlockers).toContain("async-runtime-adapter: not wired to UptimeService yet");
  expect(run.statementCounts.total).toBeGreaterThan(10);
  expect(serialized).not.toContain("secret");
  expect(serialized).not.toContain("sslmode=require");
});

test("buildPostgresMigrationDryRun blocks non-TLS database URLs", () => {
  const run = buildPostgresMigrationDryRun({
    databaseUrl: "postgres://svc:secret@db.example.invalid/uptime",
  });

  expect(run.status).toBe("blocked");
  expect(run.migrationBlockers).toContain("postgres-tls: missing sslmode=require or ssl=true");
});

test("runPostgresMigration blocks apply without explicit schema confirmation", async () => {
  const client = new FakePostgresClient();
  const run = await runPostgresMigration({
    databaseUrl: "postgres://svc:secret@db.example.invalid/uptime?sslmode=require",
    client,
    apply: true,
  });

  expect(run.status).toBe("blocked");
  expect(run.migrationBlockers).toContain("confirm-schema: expected uptime");
  expect(client.queries).toEqual([]);
});

test("runPostgresMigration applies migration statements transactionally and verifies tables", async () => {
  const dryRun = buildPostgresMigrationDryRun({
    databaseUrl: "postgres://svc:secret@db.example.invalid/uptime?sslmode=require",
  });
  const client = new FakePostgresClient([
    "schema_migrations",
    "monitors",
    "check_results",
    "incidents",
    "check_jobs",
    "probe_identities",
    "probe_submissions",
    "report_schedules",
    "report_runs",
    "report_delivery_attempts",
    "report_artifacts",
    "audit_events",
    "sync_tombstones",
  ], [
    "monitors_workspace_scope",
    "check_results_workspace_scope",
    "incidents_workspace_scope",
    "check_jobs_workspace_scope",
    "probe_identities_workspace_scope",
    "probe_submissions_workspace_scope",
    "report_schedules_workspace_scope",
    "report_runs_workspace_scope",
    "report_delivery_attempts_workspace_scope",
    "report_artifacts_workspace_scope",
    "audit_events_workspace_scope",
    "sync_tombstones_workspace_scope",
  ], [
    "monitors_workspace_status_idx",
    "monitors_workspace_name_active_idx",
    "check_results_workspace_monitor_time_idx",
    "check_jobs_workspace_status_due_idx",
    "report_schedules_due_idx",
    "report_runs_workspace_status_time_idx",
    "report_runs_schedule_window_idx",
    "report_delivery_attempts_run_idx",
    "report_delivery_attempts_due_idx",
    "report_delivery_attempts_idempotency_idx",
    "report_artifacts_run_idx",
    "audit_events_workspace_time_idx",
  ]);
  const run = await runPostgresMigration({
    databaseUrl: "postgres://svc:secret@db.example.invalid/uptime?sslmode=require",
    client,
    apply: true,
    confirmSchema: "uptime",
  });

  expect(run.status).toBe("applied");
  expect(run.appliedStatements).toBe(dryRun.statementCounts.total);
  expect(run.missingTables).toEqual([]);
  expect(run.missingPolicies).toEqual([]);
  expect(run.missingIndexes).toEqual([]);
  expect(client.queries[0]?.sql).toBe("BEGIN");
  expect(client.queries.some((query) => query.sql.includes("CREATE TABLE IF NOT EXISTS \"uptime\".\"sync_tombstones\""))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("CREATE TABLE IF NOT EXISTS \"uptime\".\"report_delivery_attempts\""))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("CREATE TABLE IF NOT EXISTS \"uptime\".\"report_artifacts\""))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("ENABLE ROW LEVEL SECURITY"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("FORCE ROW LEVEL SECURITY"))).toBe(true);
  expect(client.queries.some((query) => query.sql.includes("IF NOT EXISTS"))).toBe(true);
  expect(client.queries.some((query) => query.sql === "COMMIT")).toBe(true);
});

test("runPostgresMigration rolls back and redacts migration errors", async () => {
  const client = new FakePostgresClient();
  client.failOnSql = "monitors_workspace_scope";
  const run = await runPostgresMigration({
    databaseUrl: "postgres://svc:raw-password@db.example.invalid/uptime?sslmode=require",
    client,
    apply: true,
    confirmSchema: "uptime",
  });
  const rendered = renderPostgresMigrationRun(run);

  expect(run.status).toBe("failed");
  expect(client.queries.some((query) => query.sql === "ROLLBACK")).toBe(true);
  expect(rendered).toContain("password=redacted");
  expect(rendered).toContain("Bearer redacted");
  expect(rendered).not.toContain("raw-password");
  expect(rendered).not.toContain("raw-token");
  expect(rendered).not.toContain("sslmode=require");
});

test("runPostgresMigration reports missing policies and indexes after apply", async () => {
  const client = new FakePostgresClient([
    "schema_migrations",
    "monitors",
    "check_results",
    "incidents",
    "check_jobs",
    "probe_identities",
    "probe_submissions",
    "report_schedules",
    "report_runs",
    "report_delivery_attempts",
    "report_artifacts",
    "audit_events",
    "sync_tombstones",
  ], [], []);
  const run = await runPostgresMigration({
    databaseUrl: "postgres://svc:secret@db.example.invalid/uptime?sslmode=require",
    client,
    apply: true,
    confirmSchema: "uptime",
  });

  expect(run.status).toBe("failed");
  expect(run.missingTables).toEqual([]);
  expect(run.missingPolicies).toContain("monitors_workspace_scope");
  expect(run.missingIndexes).toContain("monitors_workspace_status_idx");
  expect(run.error).toContain("missing database objects");
});
