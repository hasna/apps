import { expect, test } from "bun:test";
import { buildPostgresMigrationPlan, redactPostgresUrl, renderPostgresMigrationPlan } from "../src/postgres-plan.js";

test("buildPostgresMigrationPlan emits a blocked cloud-store schema with tombstones and RLS", () => {
  const plan = buildPostgresMigrationPlan({
    databaseUrl: "postgres://uptime_user:super-secret@example.invalid:5432/uptime?sslmode=require",
  });
  const serialized = JSON.stringify(plan);

  expect(plan.kind).toBe("open-uptime.postgres-migration-plan");
  expect(plan.status).toBe("blocked");
  expect(plan.canApply).toBe(false);
  expect(plan.database).toMatchObject({
    configured: true,
    validPostgresUrl: true,
    tlsRequired: true,
    redactedUrl: "postgres://user:redacted@example.invalid:5432/uptime",
  });
  expect(plan.requiredTables).toContain("monitors");
  expect(plan.requiredTables).toContain("check_jobs");
  expect(plan.requiredTables).toContain("audit_events");
  expect(plan.requiredTables).toContain("sync_tombstones");
  expect(plan.requiredPolicies).toContain("monitors_workspace_scope");
  expect(plan.requiredIndexes).toContain("monitors_workspace_name_active_idx");
  expect(plan.migrationStatements.join("\n")).toContain("CREATE TABLE IF NOT EXISTS \"uptime\".\"sync_tombstones\"");
  expect(plan.migrationStatements.join("\n")).toContain("probe_policy jsonb");
  expect(plan.migrationStatements.join("\n")).toContain("probe_policy_hash text NOT NULL");
  expect(plan.migrationStatements.join("\n")).toContain("UNIQUE (workspace_id, monitor_id, monitor_version, schedule_slot, probe_policy_hash)");
  expect(plan.migrationStatements.join("\n")).toContain("fencing_token text");
  expect(plan.migrationStatements.join("\n")).toContain("idempotency_key text");
  expect(plan.migrationStatements.join("\n")).toContain("deleted_at timestamptz");
  expect(plan.migrationStatements.join("\n")).toContain("monitors_workspace_name_active_idx");
  expect(plan.rlsStatements).toContain("ALTER TABLE \"uptime\".\"monitors\" ENABLE ROW LEVEL SECURITY;");
  expect(plan.rlsStatements).toContain("ALTER TABLE \"uptime\".\"monitors\" FORCE ROW LEVEL SECURITY;");
  expect(plan.rlsStatements.join("\n")).toContain("IF NOT EXISTS");
  expect(plan.rlsStatements.join("\n")).toContain("workspace_id = current_setting('app.workspace_id', true)");
  expect(plan.safetyChecks.find((check) => check.name === "async-runtime-adapter")).toMatchObject({
    ok: false,
    detail: "not wired to UptimeService yet",
  });
  expect(plan.blockers).toContain("async-runtime-adapter: not wired to UptimeService yet");
  expect(serialized).not.toContain("super-secret");
  expect(serialized).not.toContain("sslmode=require");
});

test("Postgres migration table contracts keep workspace, idempotency, and duplicate guards", () => {
  const plan = buildPostgresMigrationPlan({
    databaseUrl: "postgres://uptime_user:super-secret@example.invalid:5432/uptime?sslmode=require",
  });
  const sql = plan.migrationStatements.join("\n");
  const table = (name: string) => {
    const pattern = new RegExp(`CREATE TABLE IF NOT EXISTS "uptime"\\."${name}" \\([\\s\\S]*?\\n\\);`);
    const match = sql.match(pattern);
    if (!match) throw new Error(`missing table ${name}`);
    return match[0];
  };

  for (const name of ["monitors", "check_results", "incidents", "check_jobs", "probe_identities", "probe_submissions", "report_schedules", "report_runs", "audit_events", "sync_tombstones"]) {
    expect(table(name)).toContain("workspace_id text NOT NULL");
  }
  for (const name of ["monitors", "check_results", "incidents", "check_jobs", "probe_identities", "probe_submissions", "report_schedules", "report_runs", "audit_events", "sync_tombstones"]) {
    expect(table(name)).toContain("idempotency_key text");
  }
  expect(table("check_jobs")).toContain("UNIQUE (workspace_id, monitor_id, monitor_version, schedule_slot, probe_policy_hash)");
  expect(table("probe_submissions")).toContain("UNIQUE (workspace_id, probe_id, nonce)");
  expect(table("probe_submissions")).toContain("UNIQUE (workspace_id, job_id)");
  expect(table("report_runs")).not.toContain("UNIQUE (workspace_id, idempotency_key)");
  expect(plan.blockers).toContain("async-runtime-adapter: not wired to UptimeService yet");
});

test("buildPostgresMigrationPlan stays blocked without a database URL", () => {
  const plan = buildPostgresMigrationPlan();

  expect(plan.database).toMatchObject({
    configured: false,
    redactedUrl: null,
    validPostgresUrl: false,
    tlsRequired: false,
  });
  expect(plan.blockers).toContain("postgres-url: <unset>");
  expect(plan.blockers).toContain("postgres-tls: <unset>");
});

test("buildPostgresMigrationPlan rejects unsafe identifiers", () => {
  expect(() => buildPostgresMigrationPlan({ schemaName: "uptime;drop" })).toThrow("Postgres schema name");
  expect(() => buildPostgresMigrationPlan({ workspaceSetting: "workspace_id" })).toThrow("workspace setting");
});

test("renderPostgresMigrationPlan is a concise non-secret summary", () => {
  const plan = buildPostgresMigrationPlan({
    schemaName: "uptime_prod",
    workspaceSetting: "hasna.workspace_id",
    databaseUrl: "postgresql://svc:secret@db.example.invalid/app?sslmode=require",
  });
  const rendered = renderPostgresMigrationPlan(plan);

  expect(rendered).toContain("Open Uptime Postgres migration plan (uptime_prod)");
  expect(rendered).toContain("database: postgresql://user:redacted@db.example.invalid/app");
  expect(rendered).toContain("database TLS: required");
  expect(rendered).toContain("workspace setting: hasna.workspace_id");
  expect(rendered).not.toContain("secret");
});

test("redactPostgresUrl hides credentials and query parameters", () => {
  expect(redactPostgresUrl("postgres://real-user:real-password@db.example.invalid:5432/app?sslmode=require"))
    .toBe("postgres://user:redacted@db.example.invalid:5432/app");
  expect(redactPostgresUrl("https://example.invalid/path?token=secret"))
    .toBe("https://example.invalid/path");
});
