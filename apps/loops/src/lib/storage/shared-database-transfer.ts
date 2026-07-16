import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppliedStorageMigration } from "./contract.js";
import { PgPoolExecutor } from "./pg-executor.js";
import { PostgresStorage } from "./postgres.js";
import { POSTGRES_STORAGE_MIGRATIONS } from "./postgres-schema.js";

export const SHARED_TRANSFER_SOURCE_DSN_ENV = "HASNA_LOOPS_TRANSFER_SOURCE_DATABASE_URL";
export const SHARED_TRANSFER_TARGET_DSN_ENV = "HASNA_LOOPS_TRANSFER_TARGET_DATABASE_URL";
export const SHARED_TRANSFER_SOURCE_DATABASE = "apps";
export const SHARED_TRANSFER_TARGET_DATABASE = "loops";
export const SHARED_TRANSFER_TARGET_BASE_THROUGH = "0007_work_item_gate_deaths";
export const SHARED_TRANSFER_TARGET_PREPARE_THROUGH = "0008_tenant_prepare";
export const SHARED_TRANSFER_FIXED_COMMAND = ["bun", "dist/serve/index.js", "shared-to-dedicated-transfer"] as const;

export const SHARED_TRANSFER_TABLES = Object.freeze([
  { name: "loops", orderBy: ["id"] },
  { name: "workflow_specs", orderBy: ["id"] },
  { name: "runner_machines", orderBy: ["id"] },
  { name: "goals", orderBy: ["id"] },
  { name: "loop_runs", orderBy: ["id"] },
  { name: "workflow_invocations", orderBy: ["id"] },
  { name: "workflow_runs", orderBy: ["id"] },
  { name: "workflow_work_items", orderBy: ["id"] },
  { name: "workflow_step_runs", orderBy: ["id"] },
  { name: "workflow_events", orderBy: ["workflow_run_id", "sequence", "id"] },
  { name: "goal_plan_nodes", orderBy: ["id"] },
  { name: "goal_runs", orderBy: ["id"] },
  { name: "runner_leases", orderBy: ["id"] },
  { name: "audit_events", orderBy: ["id"] },
  { name: "run_receipts", orderBy: ["run_id"] },
  { name: "daemon_lease", orderBy: ["id"] },
] as const);

export const SHARED_TRANSFER_API_KEY_COLUMNS = Object.freeze([
  "kid",
  "app",
  "agent",
  "scopes",
  "token_hash",
  "issued_at",
  "expires_at",
  "revoked_at",
  "revoked_reason",
  "last_used_at",
  "created_by",
  "created_at",
] as const);

const EXPECTED_TARGET_TABLES_AFTER_PREPARE = Object.freeze([
  ...SHARED_TRANSFER_TABLES.map((table) => table.name),
  "open_loops_schema_migrations",
  "tenants",
  "principals",
  "tenant_memberships",
  "tenant_roles",
  "tenant_membership_roles",
  "api_keys",
  "tenant_row_assignments",
  "api_key_tenant_bindings",
  "preauth_audit_events",
] as const);

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  (command: readonly string[], opts?: { env?: Record<string, string>; input?: string }): Promise<CommandResult>;
}

export interface SharedTransferOptions {
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  migrateTargetThrough?: (targetDsn: string, through: string) => Promise<AppliedStorageMigration[]>;
  now?: () => Date;
}

export interface TransferCount {
  table_name: string;
  row_count: string | number;
}

export interface TransferHash {
  table: string;
  sha256: string;
}

export interface TransferEvidence {
  schema: "open-loops.shared-to-dedicated-transfer/v1";
  executedAt: string;
  command: readonly string[];
  source: { database: typeof SHARED_TRANSFER_SOURCE_DATABASE };
  target: { database: typeof SHARED_TRANSFER_TARGET_DATABASE };
  archive: {
    file: "openloops-allowlist.dump";
    sha256: string;
    cleaned: boolean;
  };
  ledgers: {
    sourceContains0001Through0007: AppliedStorageMigration[];
    targetExact0001Through0007: AppliedStorageMigration[];
    targetContains0001Through0008: AppliedStorageMigration[];
  };
  sourceCounts: TransferCount[];
  targetCounts: TransferCount[];
  sourceHashes: TransferHash[];
  targetHashes: TransferHash[];
  apiKeys: {
    copiedRows: number;
    sha256: string;
    nonLoopRowsOnTarget: number;
  };
  orphanChecks: Array<{ check_name: string; orphan_count: string | number }>;
  unexpectedTargetObjects: Array<{ object_name: string; object_kind: string }>;
  nextSequence: readonly string[];
}

export async function runSharedToDedicatedTransfer(opts: SharedTransferOptions = {}): Promise<TransferEvidence> {
  const env = opts.env ?? process.env;
  const sourceDsn = requireEnv(env, SHARED_TRANSFER_SOURCE_DSN_ENV);
  const targetDsn = requireEnv(env, SHARED_TRANSFER_TARGET_DSN_ENV);
  assertDsnDatabase(sourceDsn, SHARED_TRANSFER_SOURCE_DATABASE, SHARED_TRANSFER_SOURCE_DSN_ENV);
  assertDsnDatabase(targetDsn, SHARED_TRANSFER_TARGET_DATABASE, SHARED_TRANSFER_TARGET_DSN_ENV);

  const runner = opts.runner ?? defaultCommandRunner;
  const migrateTargetThrough = opts.migrateTargetThrough ?? defaultMigrateTargetThrough;
  const archiveDir = mkdtempSync(join(tmpdir(), "openloops-transfer-"));
  chmodSync(archiveDir, 0o700);
  const serviceFile = join(archiveDir, "pg_service.conf");
  const archivePath = join(archiveDir, "openloops-allowlist.dump");
  let evidence: TransferEvidence | undefined;

  try {
    writeFileSync(serviceFile, buildPgServiceFile(sourceDsn, targetDsn), { mode: 0o600 });
    chmodSync(serviceFile, 0o600);
    const pgEnv = buildPgEnv(env, serviceFile);

    await verifyPgClientVersions(runner, pgEnv);
    const sourceLedger = assertLedgerContainsExpected(
      await readLedgerRows(runner, pgEnv, "openloops_transfer_source"),
      SHARED_TRANSFER_TARGET_BASE_THROUGH,
      "source",
    );
    const sourceQuiescence = await readJsonRows<{ check_name: string; active_count: string | number }>(
      runner,
      pgEnv,
      "openloops_transfer_source",
      quiescenceSql(),
    );
    const active = sourceQuiescence.filter((row) => Number(row.active_count) !== 0);
    if (active.length > 0) throw new Error(`source is not quiesced: ${active.map((row) => row.check_name).join(", ")}`);

    const targetBaseLedger = assertExactLedger(
      await migrateTargetThrough(targetDsn, SHARED_TRANSFER_TARGET_BASE_THROUGH),
      SHARED_TRANSFER_TARGET_BASE_THROUGH,
      "target",
    );
    const sourceCounts = await readCounts(runner, pgEnv, "openloops_transfer_source", true);
    const sourceHashes = await readTableHashes(runner, pgEnv, "openloops_transfer_source", true);

    await runChecked(runner, pgDumpCommand(archivePath), { env: pgEnv });
    const archiveSha256 = sha256File(archivePath);
    await runChecked(runner, pgRestoreCommand(archivePath), { env: pgEnv });
    const targetBaseCounts = await readCounts(runner, pgEnv, "openloops_transfer_target", false);
    const targetBaseHashes = await readTableHashes(runner, pgEnv, "openloops_transfer_target", false);
    assertCountsMatch(
      sourceCounts.filter((row) => row.table_name !== "api_keys"),
      targetBaseCounts,
      "allowlisted tables",
    );
    assertHashesMatch(
      sourceHashes.filter((row) => row.table !== "api_keys"),
      targetBaseHashes,
      "allowlisted tables",
    );

    const targetPreparedLedger = assertLedgerContainsExpected(
      await migrateTargetThrough(targetDsn, SHARED_TRANSFER_TARGET_PREPARE_THROUGH),
      SHARED_TRANSFER_TARGET_PREPARE_THROUGH,
      "target",
    );
    const apiKeysCsv = await runChecked(runner, psqlCopyApiKeysCommand("openloops_transfer_source"), { env: pgEnv });
    const apiKeyRows = countCsvRows(apiKeysCsv.stdout);
    await runChecked(runner, psqlCopyApiKeysInCommand("openloops_transfer_target"), {
      env: pgEnv,
      input: apiKeysCsv.stdout,
    });

    const targetCounts = await readCounts(runner, pgEnv, "openloops_transfer_target", true);
    assertCountsMatch(sourceCounts.filter((row) => row.table_name === "api_keys"), targetCounts.filter((row) => row.table_name === "api_keys"), "api_keys");
    const targetApiKeyHash = await readApiKeysHash(runner, pgEnv, "openloops_transfer_target");
    assertHashesMatch(sourceHashes.filter((row) => row.table === "api_keys"), [targetApiKeyHash], "api_keys");
    const targetHashes = [...targetBaseHashes, targetApiKeyHash];
    const nonLoopRows = await readScalarNumber(runner, pgEnv, "openloops_transfer_target", nonLoopApiKeysSql());
    const orphanChecks = await readJsonRows<{ check_name: string; orphan_count: string | number }>(
      runner,
      pgEnv,
      "openloops_transfer_target",
      orphanSql(),
    );
    const unexpectedTargetObjects = await readJsonRows<{ object_name: string; object_kind: string }>(
      runner,
      pgEnv,
      "openloops_transfer_target",
      unexpectedTargetObjectsSql(),
    );

    if (nonLoopRows !== 0) throw new Error("target contains non-loop api_keys rows");
    const orphanFailures = orphanChecks.filter((row) => Number(row.orphan_count) !== 0);
    if (orphanFailures.length > 0) throw new Error(`target contains FK orphans: ${orphanFailures.map((row) => row.check_name).join(", ")}`);
    if (unexpectedTargetObjects.length > 0) {
      throw new Error(`target contains unexpected database objects: ${unexpectedTargetObjects.map((row) => row.object_name).join(", ")}`);
    }

    evidence = {
      schema: "open-loops.shared-to-dedicated-transfer/v1",
      executedAt: (opts.now ?? (() => new Date()))().toISOString(),
      command: SHARED_TRANSFER_FIXED_COMMAND,
      source: { database: SHARED_TRANSFER_SOURCE_DATABASE },
      target: { database: SHARED_TRANSFER_TARGET_DATABASE },
      archive: { file: "openloops-allowlist.dump", sha256: archiveSha256, cleaned: false },
      ledgers: {
        sourceContains0001Through0007: sourceLedger,
        targetExact0001Through0007: targetBaseLedger,
        targetContains0001Through0008: targetPreparedLedger,
      },
      sourceCounts,
      targetCounts,
      sourceHashes,
      targetHashes,
      apiKeys: {
        copiedRows: apiKeyRows,
        sha256: sha256Text(apiKeysCsv.stdout),
        nonLoopRowsOnTarget: nonLoopRows,
      },
      orphanChecks,
      unexpectedTargetObjects,
      nextSequence: [
        "review canonical transfer evidence and tenant ownership mapping",
        "loops-serve tenant-backfill-s3",
        "loops-serve migrate --enforce-tenancy",
      ],
    };
    return evidence;
  } finally {
    rmSync(archiveDir, { recursive: true, force: true });
    if (evidence) evidence.archive.cleaned = !existsSync(archiveDir);
  }
}

export function buildPgServiceFile(sourceDsn: string, targetDsn: string): string {
  return [
    "[openloops_transfer_source]",
    ...dsnToServiceLines(sourceDsn),
    "",
    "[openloops_transfer_target]",
    ...dsnToServiceLines(targetDsn),
    "",
  ].join("\n");
}

export function expectedLedgerRows(through: string): AppliedStorageMigration[] {
  const throughIndex = POSTGRES_STORAGE_MIGRATIONS.findIndex((migration) => migration.id === through);
  if (throughIndex < 0) throw new Error(`unknown migration target ${through}`);
  return POSTGRES_STORAGE_MIGRATIONS.slice(0, throughIndex + 1).map((migration) => ({
    id: migration.id,
    checksum: migration.checksum,
    appliedAt: "",
  }));
}

export function assertExactLedger(
  rows: AppliedStorageMigration[],
  through: string,
  label: string,
): AppliedStorageMigration[] {
  const expected = expectedLedgerRows(through);
  const matching = assertLedgerContainsExpected(rows, through, label);
  const expectedIds = new Set(expected.map((row) => row.id));
  const unexpected = rows.filter((row) => !expectedIds.has(row.id));
  if (unexpected.length > 0) {
    throw new Error(`${label} migration ledger contains unexpected rows: ${unexpected.map((row) => row.id).join(", ")}`);
  }
  return matching;
}

export function assertLedgerContainsExpected(
  rows: AppliedStorageMigration[],
  through: string,
  label: string,
): AppliedStorageMigration[] {
  const expected = expectedLedgerRows(through);
  const actual = new Map(rows.map((row) => [row.id, row]));
  const matched: AppliedStorageMigration[] = [];
  for (const expectedRow of expected) {
    const row = actual.get(expectedRow.id);
    if (!row) throw new Error(`${label} migration ledger is missing ${expectedRow.id}`);
    if (row.checksum !== expectedRow.checksum) {
      throw new Error(`${label} migration ledger checksum mismatch for ${expectedRow.id}`);
    }
    matched.push(row);
  }
  return matched;
}

export function pgDumpCommand(archivePath: string): readonly string[] {
  return [
    "pg_dump",
    "--dbname=service=openloops_transfer_source",
    "--format=custom",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    `--file=${archivePath}`,
    ...SHARED_TRANSFER_TABLES.map((table) => `--table=public.${table.name}`),
  ];
}

export function pgRestoreCommand(archivePath: string): readonly string[] {
  return [
    "pg_restore",
    "--dbname=service=openloops_transfer_target",
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--single-transaction",
    "--exit-on-error",
    archivePath,
  ];
}

function psqlCommand(service: "openloops_transfer_source" | "openloops_transfer_target", sql: string): readonly string[] {
  return [
    "psql",
    "--no-psqlrc",
    "--quiet",
    "--tuples-only",
    "--no-align",
    "--set=ON_ERROR_STOP=1",
    `--dbname=service=${service}`,
    "--command",
    sql,
  ];
}

function psqlCopyApiKeysCommand(service: "openloops_transfer_source"): readonly string[] {
  return psqlCommand(
    service,
    `COPY (SELECT ${SHARED_TRANSFER_API_KEY_COLUMNS.map(quoteIdent).join(", ")} FROM public.api_keys WHERE app = 'loops' ORDER BY kid) TO STDOUT WITH (FORMAT csv, NULL '\\N')`,
  );
}

function psqlCopyApiKeysInCommand(service: "openloops_transfer_target"): readonly string[] {
  return psqlCommand(
    service,
    `COPY public.api_keys (${SHARED_TRANSFER_API_KEY_COLUMNS.map(quoteIdent).join(", ")}) FROM STDIN WITH (FORMAT csv, NULL '\\N')`,
  );
}

function ledgerSql(): string {
  return jsonRowsSql(
    `SELECT id, checksum, applied_at AS "appliedAt" FROM public.open_loops_schema_migrations ORDER BY id`,
  );
}

function countsSql(includeApiKeys: boolean): string {
  const selects = SHARED_TRANSFER_TABLES.map((table) =>
    `SELECT '${table.name}' AS table_name, COUNT(*)::text AS row_count FROM public.${quoteIdent(table.name)}`);
  if (includeApiKeys) {
    selects.push("SELECT 'api_keys' AS table_name, COUNT(*)::text AS row_count FROM public.api_keys WHERE app = 'loops'");
  }
  return jsonRowsSql(selects.join(" UNION ALL "));
}

function rowHashSql(table: (typeof SHARED_TRANSFER_TABLES)[number]): string {
  return `COPY (SELECT row_to_json(row_data)::text FROM (SELECT * FROM public.${quoteIdent(table.name)} ORDER BY ${table.orderBy.map(quoteIdent).join(", ")}) row_data) TO STDOUT`;
}

function apiKeysHashSql(): string {
  return `COPY (SELECT row_to_json(row_data)::text FROM (SELECT ${SHARED_TRANSFER_API_KEY_COLUMNS.map(quoteIdent).join(", ")} FROM public.api_keys WHERE app = 'loops' ORDER BY kid) row_data) TO STDOUT`;
}

function quiescenceSql(): string {
  return jsonRowsSql([
    "SELECT 'loop_runs_active' AS check_name, COUNT(*)::text AS active_count FROM public.loop_runs WHERE status IN ('running', 'claimed')",
    "SELECT 'workflow_runs_active' AS check_name, COUNT(*)::text AS active_count FROM public.workflow_runs WHERE status IN ('running', 'claimed')",
    "SELECT 'workflow_step_runs_active' AS check_name, COUNT(*)::text AS active_count FROM public.workflow_step_runs WHERE status IN ('running', 'claimed')",
    "SELECT 'runner_leases_active' AS check_name, COUNT(*)::text AS active_count FROM public.runner_leases WHERE status = 'active'",
    "SELECT 'workflow_work_items_active' AS check_name, COUNT(*)::text AS active_count FROM public.workflow_work_items WHERE status IN ('leased', 'running')",
  ].join(" UNION ALL "));
}

function nonLoopApiKeysSql(): string {
  return "SELECT COUNT(*)::text FROM public.api_keys WHERE app <> 'loops'";
}

function orphanSql(): string {
  return jsonRowsSql([
    orphan("loop_runs.loop_id", "loop_runs child", "loops parent", "parent.id = child.loop_id", "parent.id IS NULL"),
    orphan("workflow_runs.workflow_id", "workflow_runs child", "workflow_specs parent", "parent.id = child.workflow_id", "parent.id IS NULL"),
    orphan("workflow_runs.loop_id", "workflow_runs child", "loops parent", "parent.id = child.loop_id", "child.loop_id IS NOT NULL AND parent.id IS NULL"),
    orphan("workflow_runs.loop_run_id", "workflow_runs child", "loop_runs parent", "parent.id = child.loop_run_id", "child.loop_run_id IS NOT NULL AND parent.id IS NULL"),
    orphan("workflow_work_items.invocation_id", "workflow_work_items child", "workflow_invocations parent", "parent.id = child.invocation_id", "parent.id IS NULL"),
    orphan("workflow_work_items.workflow_id", "workflow_work_items child", "workflow_specs parent", "parent.id = child.workflow_id", "child.workflow_id IS NOT NULL AND parent.id IS NULL"),
    orphan("workflow_work_items.loop_id", "workflow_work_items child", "loops parent", "parent.id = child.loop_id", "child.loop_id IS NOT NULL AND parent.id IS NULL"),
    orphan("workflow_work_items.workflow_run_id", "workflow_work_items child", "workflow_runs parent", "parent.id = child.workflow_run_id", "child.workflow_run_id IS NOT NULL AND parent.id IS NULL"),
    orphan("workflow_step_runs.workflow_run_id", "workflow_step_runs child", "workflow_runs parent", "parent.id = child.workflow_run_id", "parent.id IS NULL"),
    orphan("workflow_events.workflow_run_id", "workflow_events child", "workflow_runs parent", "parent.id = child.workflow_run_id", "parent.id IS NULL"),
    orphan("goal_plan_nodes.goal_id", "goal_plan_nodes child", "goals parent", "parent.id = child.goal_id", "parent.id IS NULL"),
    orphan("goal_runs.goal_id", "goal_runs child", "goals parent", "parent.id = child.goal_id", "parent.id IS NULL"),
    orphan("runner_leases.runner_id", "runner_leases child", "runner_machines parent", "parent.id = child.runner_id", "parent.id IS NULL"),
    orphan("runner_leases.loop_run_id", "runner_leases child", "loop_runs parent", "parent.id = child.loop_run_id", "child.loop_run_id IS NOT NULL AND parent.id IS NULL"),
    orphan("runner_leases.workflow_run_id", "runner_leases child", "workflow_runs parent", "parent.id = child.workflow_run_id", "child.workflow_run_id IS NOT NULL AND parent.id IS NULL"),
    orphan("run_receipts.loop_id", "run_receipts child", "loops parent", "parent.id = child.loop_id", "parent.id IS NULL"),
  ].join(" UNION ALL "));
}

function unexpectedTargetObjectsSql(): string {
  const values = EXPECTED_TARGET_TABLES_AFTER_PREPARE.map((table) => `('${table}')`).join(", ");
  return jsonRowsSql(`
    WITH expected(table_name) AS (VALUES ${values})
    SELECT namespace.nspname AS object_name, 'schema' AS object_kind
      FROM pg_namespace namespace
     WHERE namespace.nspname NOT IN ('public', 'pg_catalog', 'information_schema')
       AND namespace.nspname NOT LIKE 'pg_toast%'
       AND namespace.nspname NOT LIKE 'pg_temp_%'
    UNION ALL
    SELECT 'public.' || class.relname AS object_name,
           CASE class.relkind
             WHEN 'r' THEN 'table'
             WHEN 'p' THEN 'partitioned_table'
             WHEN 'S' THEN 'sequence'
             WHEN 'v' THEN 'view'
             WHEN 'm' THEN 'materialized_view'
             WHEN 'f' THEN 'foreign_table'
             ELSE class.relkind::text
           END AS object_kind
      FROM pg_class class
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
       AND class.relname NOT IN (SELECT table_name FROM expected)
    UNION ALL
    SELECT 'public.' || proc.proname || '(' || pg_get_function_identity_arguments(proc.oid) || ')' AS object_name,
           'function' AS object_kind
      FROM pg_proc proc
      JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
     WHERE namespace.nspname = 'public'
    ORDER BY object_kind, object_name
  `);
}

function orphan(
  checkName: string,
  child: string,
  parent: string,
  joinCondition: string,
  whereCondition: string,
): string {
  return `SELECT '${checkName}' AS check_name, COUNT(*)::text AS orphan_count FROM public.${child} LEFT JOIN public.${parent} ON ${joinCondition} WHERE ${whereCondition}`;
}

function jsonRowsSql(sql: string): string {
  return `SELECT COALESCE(jsonb_agg(to_jsonb(rows)), '[]'::jsonb)::text FROM (${sql}) rows`;
}

async function verifyPgClientVersions(runner: CommandRunner, env: Record<string, string>): Promise<void> {
  for (const binary of ["pg_dump", "pg_restore", "psql"]) {
    const result = await runChecked(runner, [binary, "--version"], { env });
    if (!/\(PostgreSQL\)\s+16\./.test(result.stdout)) {
      throw new Error(`${binary} must be PostgreSQL 16.x`);
    }
  }
}

async function readLedgerRows(
  runner: CommandRunner,
  env: Record<string, string>,
  service: "openloops_transfer_source" | "openloops_transfer_target",
): Promise<AppliedStorageMigration[]> {
  return readJsonRows<AppliedStorageMigration>(runner, env, service, ledgerSql());
}

async function readCounts(
  runner: CommandRunner,
  env: Record<string, string>,
  service: "openloops_transfer_source" | "openloops_transfer_target",
  includeApiKeys: boolean,
): Promise<TransferCount[]> {
  return readJsonRows<TransferCount>(runner, env, service, countsSql(includeApiKeys));
}

async function readTableHashes(
  runner: CommandRunner,
  env: Record<string, string>,
  service: "openloops_transfer_source" | "openloops_transfer_target",
  includeApiKeys: boolean,
): Promise<TransferHash[]> {
  const hashes: TransferHash[] = [];
  for (const table of SHARED_TRANSFER_TABLES) {
    const result = await runChecked(runner, psqlCommand(service, rowHashSql(table)), { env });
    hashes.push({ table: table.name, sha256: sha256Text(result.stdout) });
  }
  if (includeApiKeys) {
    const result = await runChecked(runner, psqlCommand(service, apiKeysHashSql()), { env });
    hashes.push({ table: "api_keys", sha256: sha256Text(result.stdout) });
  }
  return hashes;
}

async function readApiKeysHash(
  runner: CommandRunner,
  env: Record<string, string>,
  service: "openloops_transfer_source" | "openloops_transfer_target",
): Promise<TransferHash> {
  const result = await runChecked(runner, psqlCommand(service, apiKeysHashSql()), { env });
  return { table: "api_keys", sha256: sha256Text(result.stdout) };
}

async function readJsonRows<T>(
  runner: CommandRunner,
  env: Record<string, string>,
  service: "openloops_transfer_source" | "openloops_transfer_target",
  sql: string,
): Promise<T[]> {
  const result = await runChecked(runner, psqlCommand(service, sql), { env });
  return JSON.parse(result.stdout.trim() || "[]") as T[];
}

async function readScalarNumber(
  runner: CommandRunner,
  env: Record<string, string>,
  service: "openloops_transfer_source" | "openloops_transfer_target",
  sql: string,
): Promise<number> {
  const result = await runChecked(runner, psqlCommand(service, sql), { env });
  return Number(result.stdout.trim());
}

async function runChecked(
  runner: CommandRunner,
  command: readonly string[],
  opts: { env: Record<string, string>; input?: string },
): Promise<CommandResult> {
  const result = await runner(command, opts);
  if (result.exitCode !== 0) throw new Error(`${command[0]} failed with exit code ${result.exitCode}`);
  return result;
}

async function defaultMigrateTargetThrough(targetDsn: string, through: string): Promise<AppliedStorageMigration[]> {
  const executor = PgPoolExecutor.fromConnectionString({
    connectionString: targetDsn,
    applicationName: "loops-shared-database-transfer",
    max: 2,
  });
  try {
    const schema = new PostgresStorage(executor);
    const result = await schema.migrate({ through });
    return result.applied;
  } finally {
    await executor.close();
  }
}

async function defaultCommandRunner(command: readonly string[], opts: { env?: Record<string, string>; input?: string } = {}): Promise<CommandResult> {
  const result = Bun.spawnSync({
    cmd: [...command],
    env: opts.env,
    stdin: opts.input ? Buffer.from(opts.input) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function buildPgEnv(env: NodeJS.ProcessEnv, serviceFile: string): Record<string, string> {
  const pgEnv: Record<string, string> = {
    PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    PGSERVICEFILE: serviceFile,
    PGCONNECT_TIMEOUT: env.PGCONNECT_TIMEOUT ?? "10",
    PGAPPNAME: "openloops-shared-to-dedicated-transfer",
  };
  for (const name of ["PGSSLROOTCERT", "SSL_CERT_FILE", "SSL_CERT_DIR"]) {
    const value = env[name]?.trim();
    if (value) pgEnv[name] = value;
  }
  return pgEnv;
}

function dsnToServiceLines(dsn: string): string[] {
  const url = new URL(dsn);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Postgres DSN must use postgres:// or postgresql://");
  }
  const lines = [
    `host=${safeServiceValue(decodeURIComponent(url.hostname))}`,
    `port=${safeServiceValue(url.port || "5432")}`,
    `dbname=${safeServiceValue(decodeURIComponent(url.pathname.replace(/^\//, "")))}`,
  ];
  if (url.username) lines.push(`user=${safeServiceValue(decodeURIComponent(url.username))}`);
  if (url.password) lines.push(`password=${safeServiceValue(decodeURIComponent(url.password))}`);
  for (const [key, value] of url.searchParams.entries()) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid libpq parameter ${key}`);
    lines.push(`${key}=${safeServiceValue(value)}`);
  }
  return lines;
}

function safeServiceValue(value: string): string {
  if (!value || /[\0\r\n]/.test(value)) throw new Error("invalid Postgres service value");
  return value;
}

function assertDsnDatabase(dsn: string, expected: string, envName: string): void {
  const actual = decodeURIComponent(new URL(dsn).pathname.replace(/^\//, ""));
  if (actual !== expected) {
    throw new Error(`${envName} must point at database ${expected}`);
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`missing required ECS secret env ${name}`);
  return value;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

function countCsvRows(csv: string): number {
  const trimmed = csv.trim();
  return trimmed ? trimmed.split(/\r?\n/).length : 0;
}

function assertCountsMatch(source: TransferCount[], target: TransferCount[], label: string): void {
  const targetByTable = new Map(target.map((row) => [row.table_name, String(row.row_count)]));
  for (const row of source) {
    const targetCount = targetByTable.get(row.table_name);
    if (targetCount !== String(row.row_count)) {
      throw new Error(`${label} row count mismatch for ${row.table_name}`);
    }
  }
}

function assertHashesMatch(source: TransferHash[], target: TransferHash[], label: string): void {
  const targetByTable = new Map(target.map((row) => [row.table, row.sha256]));
  for (const row of source) {
    const targetHash = targetByTable.get(row.table);
    if (targetHash !== row.sha256) {
      throw new Error(`${label} canonical SHA-256 mismatch for ${row.table}`);
    }
  }
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
