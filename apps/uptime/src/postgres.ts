import pg from "pg";
import type { Pool, QueryResult } from "pg";
import {
  buildPostgresMigrationPlan,
  redactPostgresUrl,
  type PostgresMigrationPlan,
  type PostgresMigrationPlanOptions,
} from "./postgres-plan.js";

export const POSTGRES_MIGRATION_RUN_VERSION = 1;

export interface PostgresQueryClient {
  query(sql: string, params?: unknown[]): Promise<Pick<QueryResult, "rows" | "rowCount">>;
  end?(): Promise<void>;
}

export interface PostgresMigrationRunOptions extends PostgresMigrationPlanOptions {
  databaseUrl?: string;
  apply?: boolean;
  confirmSchema?: string;
  client?: PostgresQueryClient;
  now?: () => Date;
}

export interface PostgresMigrationRun {
  kind: "open-uptime.postgres-migration-run";
  version: number;
  mode: "dry-run" | "apply";
  status: "blocked" | "planned" | "applied" | "failed";
  schemaName: string;
  workspaceSetting: string;
  database: PostgresMigrationPlan["database"];
  runtimePromotionReady: false;
  runtimeBlockers: string[];
  migrationBlockers: string[];
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  statementCounts: {
    migrations: number;
    rls: number;
    total: number;
  };
  appliedStatements: number;
  verifiedTables: string[];
  missingTables: string[];
  verifiedPolicies: string[];
  missingPolicies: string[];
  verifiedIndexes: string[];
  missingIndexes: string[];
  startedAt: string;
  finishedAt: string;
  error: string | null;
  nextActions: string[];
}

const RUNTIME_BLOCKER_PREFIXES = ["async-runtime-adapter"];

export function buildPostgresMigrationDryRun(options: PostgresMigrationPlanOptions = {}): PostgresMigrationRun {
  const plan = buildPostgresMigrationPlan(options);
  const migrationBlockers = migrationBlockersFor(plan, false, undefined);
  const now = new Date().toISOString();
  return {
    kind: "open-uptime.postgres-migration-run",
    version: POSTGRES_MIGRATION_RUN_VERSION,
    mode: "dry-run",
    status: migrationBlockers.length === 0 ? "planned" : "blocked",
    schemaName: plan.schemaName,
    workspaceSetting: plan.workspaceSetting,
    database: plan.database,
    runtimePromotionReady: false,
    runtimeBlockers: runtimeBlockersFor(plan),
    migrationBlockers,
    checks: migrationChecks(plan, false, undefined, migrationBlockers),
    statementCounts: statementCountsFor(plan),
    appliedStatements: 0,
    verifiedTables: [],
    missingTables: [],
    verifiedPolicies: [],
    missingPolicies: [],
    verifiedIndexes: [],
    missingIndexes: [],
    startedAt: now,
    finishedAt: now,
    error: null,
    nextActions: migrationNextActions(),
  };
}

export async function runPostgresMigration(options: PostgresMigrationRunOptions = {}): Promise<PostgresMigrationRun> {
  const plan = buildPostgresMigrationPlan(options);
  const apply = options.apply === true;
  if (!apply) return buildPostgresMigrationDryRun(options);

  const startedAt = (options.now ?? (() => new Date()))().toISOString();
  const migrationBlockers = migrationBlockersFor(plan, true, options.confirmSchema);
  const base = (status: PostgresMigrationRun["status"], extra: Partial<PostgresMigrationRun> = {}): PostgresMigrationRun => ({
    kind: "open-uptime.postgres-migration-run",
    version: POSTGRES_MIGRATION_RUN_VERSION,
    mode: "apply",
    status,
    schemaName: plan.schemaName,
    workspaceSetting: plan.workspaceSetting,
    database: plan.database,
    runtimePromotionReady: false,
    runtimeBlockers: runtimeBlockersFor(plan),
    migrationBlockers,
    checks: migrationChecks(plan, true, options.confirmSchema, migrationBlockers),
    statementCounts: statementCountsFor(plan),
    appliedStatements: 0,
    verifiedTables: [],
    missingTables: [...plan.requiredTables],
    verifiedPolicies: [],
    missingPolicies: [...plan.requiredPolicies],
    verifiedIndexes: [],
    missingIndexes: [...plan.requiredIndexes],
    startedAt,
    finishedAt: (options.now ?? (() => new Date()))().toISOString(),
    error: null,
    nextActions: migrationNextActions(),
    ...extra,
  });

  if (migrationBlockers.length > 0) return base("blocked");

  let client = options.client;
  let ownedClient: PostgresQueryClient | null = null;
  const databaseUrl = options.databaseUrl ?? process.env.HASNA_UPTIME_DATABASE_URL;
  try {
    if (!client) {
      if (!databaseUrl) return base("blocked", { migrationBlockers: ["postgres-url: <unset>"] });
      ownedClient = createPostgresPool(databaseUrl);
      client = ownedClient;
    }
    let appliedStatements = 0;
    await client.query("BEGIN");
    try {
      for (const statement of [...plan.migrationStatements, ...plan.rlsStatements]) {
        await client.query(statement);
        appliedStatements += 1;
      }
      await client.query("COMMIT");
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    }
    const verifiedTables = await listExistingTables(client, plan.schemaName, plan.requiredTables);
    const verifiedPolicies = await listExistingPolicies(client, plan.schemaName, plan.requiredPolicies);
    const verifiedIndexes = await listExistingIndexes(client, plan.schemaName, plan.requiredIndexes);
    const missingTables = plan.requiredTables.filter((table) => !verifiedTables.includes(table));
    const missingPolicies = plan.requiredPolicies.filter((policy) => !verifiedPolicies.includes(policy));
    const missingIndexes = plan.requiredIndexes.filter((index) => !verifiedIndexes.includes(index));
    const missingObjects = [...missingTables, ...missingPolicies, ...missingIndexes];
    return base(missingObjects.length === 0 ? "applied" : "failed", {
      appliedStatements,
      verifiedTables,
      verifiedPolicies,
      verifiedIndexes,
      missingTables,
      missingPolicies,
      missingIndexes,
      error: missingObjects.length === 0 ? null : `missing database objects after migration: ${missingObjects.join(", ")}`,
    });
  } catch (error) {
    return base("failed", {
      error: sanitizePostgresError(error, databaseUrl),
    });
  } finally {
    await ownedClient?.end?.();
  }
}

export function renderPostgresMigrationRun(run: PostgresMigrationRun): string {
  return [
    `Open Uptime Postgres migration ${run.mode}`,
    `status: ${run.status}`,
    `database: ${run.database.redactedUrl ?? "<unset>"}`,
    `schema: ${run.schemaName}`,
    `workspace setting: ${run.workspaceSetting}`,
    `statements: ${run.statementCounts.total}`,
    `applied statements: ${run.appliedStatements}`,
    `verified tables: ${run.verifiedTables.length}`,
    `missing tables: ${run.missingTables.length ? run.missingTables.join(", ") : "none"}`,
    `verified policies: ${run.verifiedPolicies.length}`,
    `missing policies: ${run.missingPolicies.length ? run.missingPolicies.join(", ") : "none"}`,
    `verified indexes: ${run.verifiedIndexes.length}`,
    `missing indexes: ${run.missingIndexes.length ? run.missingIndexes.join(", ") : "none"}`,
    `runtime promotion ready: ${run.runtimePromotionReady}`,
    `migration blockers: ${run.migrationBlockers.length}`,
    ...run.migrationBlockers.map((blocker) => `- ${blocker}`),
    `runtime blockers: ${run.runtimeBlockers.length}`,
    ...run.runtimeBlockers.map((blocker) => `- ${blocker}`),
    run.error ? `error: ${run.error}` : null,
  ].filter(Boolean).join("\n");
}

export function createPostgresPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, ssl: sslConfigFor(connectionString) });
}

function migrationBlockersFor(plan: PostgresMigrationPlan, apply: boolean, confirmSchema: string | undefined): string[] {
  const blockers = plan.blockers.filter((blocker) => !isRuntimeOnlyBlocker(blocker));
  if (apply && confirmSchema !== plan.schemaName) {
    blockers.push(`confirm-schema: expected ${plan.schemaName}`);
  }
  return blockers;
}

function runtimeBlockersFor(plan: PostgresMigrationPlan): string[] {
  return plan.blockers.filter(isRuntimeOnlyBlocker);
}

function isRuntimeOnlyBlocker(blocker: string): boolean {
  return RUNTIME_BLOCKER_PREFIXES.some((prefix) => blocker.startsWith(`${prefix}:`));
}

function migrationChecks(
  plan: PostgresMigrationPlan,
  apply: boolean,
  confirmSchema: string | undefined,
  blockers: string[],
): Array<{ name: string; ok: boolean; detail: string }> {
  return [
    ...plan.safetyChecks.filter((check) => !RUNTIME_BLOCKER_PREFIXES.includes(check.name)),
    {
      name: "confirm-schema",
      ok: !apply || confirmSchema === plan.schemaName,
      detail: apply ? confirmSchema ?? "<unset>" : "not required for dry-run",
    },
    {
      name: "migration-apply",
      ok: blockers.length === 0,
      detail: blockers.length === 0 ? "ready" : "blocked",
    },
  ];
}

function statementCountsFor(plan: PostgresMigrationPlan): PostgresMigrationRun["statementCounts"] {
  return {
    migrations: plan.migrationStatements.length,
    rls: plan.rlsStatements.length,
    total: plan.migrationStatements.length + plan.rlsStatements.length,
  };
}

async function listExistingTables(client: PostgresQueryClient, schemaName: string, requiredTables: string[]): Promise<string[]> {
  const result = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])",
    [schemaName, requiredTables],
  );
  return result.rows
    .map((row) => String((row as { table_name?: unknown }).table_name ?? ""))
    .filter((tableName) => requiredTables.includes(tableName));
}

async function listExistingPolicies(client: PostgresQueryClient, schemaName: string, requiredPolicies: string[]): Promise<string[]> {
  const result = await client.query(
    "SELECT policyname FROM pg_policies WHERE schemaname = $1 AND policyname = ANY($2::text[])",
    [schemaName, requiredPolicies],
  );
  return result.rows
    .map((row) => String((row as { policyname?: unknown }).policyname ?? ""))
    .filter((policyName) => requiredPolicies.includes(policyName));
}

async function listExistingIndexes(client: PostgresQueryClient, schemaName: string, requiredIndexes: string[]): Promise<string[]> {
  const result = await client.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2::text[])",
    [schemaName, requiredIndexes],
  );
  return result.rows
    .map((row) => String((row as { indexname?: unknown }).indexname ?? ""))
    .filter((indexName) => requiredIndexes.includes(indexName));
}

async function rollbackQuietly(client: PostgresQueryClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original migration error. Rollback failure is intentionally not surfaced.
  }
}

function sanitizePostgresError(error: unknown, databaseUrl: string | undefined): string {
  let message = error instanceof Error ? error.message : String(error);
  if (databaseUrl) {
    message = message.split(databaseUrl).join(redactPostgresUrl(databaseUrl));
  }
  return message
    .replace(/(password|token|secret|api[_-]?key)=([^&\s]+)/gi, "$1=redacted")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer redacted");
}

function sslConfigFor(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode === "disable") return undefined;
  const wantsSsl = sslMode === "require" || sslMode === "verify-full" || url.searchParams.get("ssl") === "true";
  if (!wantsSsl) return undefined;
  return { rejectUnauthorized: process.env.HASNA_UPTIME_PG_SSL_INSECURE === "1" ? false : true };
}

function migrationNextActions(): string[] {
  return [
    "Run this command in dry-run mode first and review the redacted result.",
    "Apply only from the migration task with --apply and --confirm-schema after a fresh backup/rollback checkpoint.",
    "Keep hosted web and workers fail-closed for Postgres runtime promotion until the service store is switched to the async adapter and workspace-scoped query tests pass.",
  ];
}
