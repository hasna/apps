import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { getDatabase, getDatabasePath, now } from "../db/database.js";
import {
  TODOS_LOCAL_BRIDGE_KIND,
  TODOS_LOCAL_BRIDGE_SCHEMA_VERSION,
  createLocalBridgeBundle,
  importLocalBridgeBundle,
  validateLocalBridgeBundle,
  type ImportLocalBridgeOptions,
  type LocalBridgeImportResult,
  type TodosLocalBridgeBundle,
  type TodosLocalBridgeData,
  type TodosLocalBridgePackageSource,
  type TodosLocalBridgeSource,
} from "./local-bridge.js";
import { getPackageVersion } from "./package-version.js";

export const TODOS_LOCAL_BACKUP_KIND = "hasna.todos.local-backup";
export const TODOS_LOCAL_BACKUP_SCHEMA_VERSION = 1;
export const TODOS_LOCAL_INTEGRITY_KIND = "hasna.todos.local-integrity";
export const TODOS_LOCAL_INTEGRITY_SCHEMA_VERSION = 1;
export const LOCAL_BACKUP_CHECKSUM_ALGORITHM = "sha256";

export interface CreateLocalBackupOptions {
  project_id?: string;
  generated_at?: string;
  version?: string;
  output_path?: string;
}

export interface LocalBackupSqliteIntegrity {
  quick_check: string;
  foreign_key_violations: number;
  ok: boolean;
}

export interface LocalBackupManifest {
  schema_version: typeof TODOS_LOCAL_BACKUP_SCHEMA_VERSION;
  kind: typeof TODOS_LOCAL_BACKUP_KIND;
  local_only: true;
  no_network: true;
  created_at: string;
  package: TodosLocalBridgePackageSource;
  source: TodosLocalBridgeSource;
  bridge: {
    kind: typeof TODOS_LOCAL_BRIDGE_KIND;
    schema_version: typeof TODOS_LOCAL_BRIDGE_SCHEMA_VERSION;
    exported_at: string;
    checksum: string;
    stats: Record<keyof TodosLocalBridgeData, number>;
    artifact_contents: number;
  };
  database: {
    path: string;
    integrity: LocalBackupSqliteIntegrity;
  };
  checksum_algorithm: typeof LOCAL_BACKUP_CHECKSUM_ALGORITHM;
  section_checksums: Record<keyof TodosLocalBridgeData, string>;
  warnings: string[];
}

export interface LocalBackupBundle {
  schema_version: typeof TODOS_LOCAL_BACKUP_SCHEMA_VERSION;
  kind: typeof TODOS_LOCAL_BACKUP_KIND;
  local_only: true;
  no_network: true;
  created_at: string;
  package: TodosLocalBridgePackageSource;
  manifest: LocalBackupManifest;
  bridge: TodosLocalBridgeBundle;
  checksum_algorithm: typeof LOCAL_BACKUP_CHECKSUM_ALGORITHM;
  checksum: string;
}

export interface LocalBackupVerification {
  schema_version: typeof TODOS_LOCAL_BACKUP_SCHEMA_VERSION;
  kind: "hasna.todos.local-backup-verification";
  local_only: true;
  no_network: true;
  verified_at: string;
  ok: boolean;
  checksum_algorithm: typeof LOCAL_BACKUP_CHECKSUM_ALGORITHM;
  checksum: {
    expected: string | null;
    actual: string | null;
    ok: boolean;
  };
  bridge_checksum: {
    expected: string | null;
    actual: string | null;
    ok: boolean;
  };
  bridge_validation: ReturnType<typeof validateLocalBridgeBundle>;
  sqlite: LocalBackupSqliteIntegrity | null;
  counts: {
    expected: Partial<Record<keyof TodosLocalBridgeData, number>>;
    actual: Partial<Record<keyof TodosLocalBridgeData, number>>;
    ok: boolean;
  };
  compatible: boolean;
  issues: string[];
  warnings: string[];
}

export interface RestoreLocalBackupOptions {
  apply?: boolean;
  conflict_strategy?: ImportLocalBridgeOptions["conflictStrategy"];
  verified_at?: string;
}

export interface LocalBackupRestoreResult {
  schema_version: typeof TODOS_LOCAL_BACKUP_SCHEMA_VERSION;
  kind: "hasna.todos.local-backup-restore";
  local_only: true;
  no_network: true;
  restored_at: string;
  dry_run: boolean;
  ok: boolean;
  verification: LocalBackupVerification;
  import_result: LocalBridgeImportResult | null;
  issues: string[];
}

export interface LocalIntegrityReport {
  schema_version: typeof TODOS_LOCAL_INTEGRITY_SCHEMA_VERSION;
  kind: typeof TODOS_LOCAL_INTEGRITY_KIND;
  local_only: true;
  no_network: true;
  generated_at: string;
  database_path: string;
  sqlite: LocalBackupSqliteIntegrity;
  bridge_validation: ReturnType<typeof validateLocalBridgeBundle>;
  counts: Record<keyof TodosLocalBridgeData, number>;
  orphaned_rows: Record<string, number>;
  ok: boolean;
  issues: string[];
  warnings: string[];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function sqliteIntegrity(db: Database): LocalBackupSqliteIntegrity {
  let quick = "unknown";
  try {
    const row = db.query("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    quick = row?.quick_check ?? "unknown";
  } catch (error) {
    quick = error instanceof Error ? error.message : String(error);
  }
  let foreignKeyViolations = 0;
  try {
    foreignKeyViolations = db.query("PRAGMA foreign_key_check").all().length;
  } catch {
    foreignKeyViolations = 0;
  }
  return {
    quick_check: quick,
    foreign_key_violations: foreignKeyViolations,
    ok: quick === "ok" && foreignKeyViolations === 0,
  };
}

function bridgeStats(data: TodosLocalBridgeData): Record<keyof TodosLocalBridgeData, number> {
  return Object.fromEntries(
    (Object.keys(data) as Array<keyof TodosLocalBridgeData>).map((key) => [key, data[key].length]),
  ) as Record<keyof TodosLocalBridgeData, number>;
}

function sectionChecksums(data: TodosLocalBridgeData): Record<keyof TodosLocalBridgeData, string> {
  return Object.fromEntries(
    (Object.keys(data) as Array<keyof TodosLocalBridgeData>).map((key) => [key, sha256(data[key])]),
  ) as Record<keyof TodosLocalBridgeData, string>;
}

function checksumPayload(bundle: Omit<LocalBackupBundle, "checksum">): string {
  return sha256(bundle);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function createLocalBackup(
  options: CreateLocalBackupOptions = {},
  db?: Database,
): LocalBackupBundle {
  const d = getDatabase(db);
  const createdAt = options.generated_at ?? now();
  const bridge = createLocalBridgeBundle({
    project_id: options.project_id,
    generatedAt: createdAt,
    version: options.version,
  }, d);
  const integrity = sqliteIntegrity(d);
  const bridgeChecksum = sha256(bridge);
  const warnings: string[] = [];
  if (!integrity.ok) warnings.push("current SQLite integrity check did not pass");

  const manifest: LocalBackupManifest = {
    schema_version: TODOS_LOCAL_BACKUP_SCHEMA_VERSION,
    kind: TODOS_LOCAL_BACKUP_KIND,
    local_only: true,
    no_network: true,
    created_at: createdAt,
    package: bridge.package,
    source: bridge.source,
    bridge: {
      kind: TODOS_LOCAL_BRIDGE_KIND,
      schema_version: TODOS_LOCAL_BRIDGE_SCHEMA_VERSION,
      exported_at: bridge.exportedAt,
      checksum: bridgeChecksum,
      stats: bridge.stats,
      artifact_contents: bridge.artifact_contents?.length ?? 0,
    },
    database: {
      path: getDatabasePath(),
      integrity,
    },
    checksum_algorithm: LOCAL_BACKUP_CHECKSUM_ALGORITHM,
    section_checksums: sectionChecksums(bridge.data),
    warnings,
  };
  const withoutChecksum: Omit<LocalBackupBundle, "checksum"> = {
    schema_version: TODOS_LOCAL_BACKUP_SCHEMA_VERSION,
    kind: TODOS_LOCAL_BACKUP_KIND,
    local_only: true,
    no_network: true,
    created_at: createdAt,
    package: bridge.package,
    manifest,
    bridge,
    checksum_algorithm: LOCAL_BACKUP_CHECKSUM_ALGORITHM,
  };
  const backup: LocalBackupBundle = {
    ...withoutChecksum,
    checksum: checksumPayload(withoutChecksum),
  };
  if (options.output_path) writeLocalBackupFile(backup, options.output_path);
  return backup;
}

export function writeLocalBackupFile(backup: LocalBackupBundle, outputPath: string): string {
  const path = resolve(outputPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(backup, null, 2)}\n`);
  return path;
}

export function readLocalBackupFile(path: string): LocalBackupBundle {
  return JSON.parse(readFileSync(resolve(path), "utf-8")) as LocalBackupBundle;
}

export function verifyLocalBackup(
  value: unknown,
  options: { verified_at?: string; check_sqlite?: boolean } = {},
  db?: Database,
): LocalBackupVerification {
  const verifiedAt = options.verified_at ?? now();
  const record = asRecord(value);
  const issues: string[] = [];
  const warnings: string[] = [];
  const bridge = record?.bridge as TodosLocalBridgeBundle | undefined;
  const manifest = asRecord(record?.manifest);
  const expectedChecksum = typeof record?.checksum === "string" ? record.checksum : null;
  const expectedBridgeChecksum = typeof manifest?.bridge === "object" && manifest.bridge && "checksum" in manifest.bridge
    ? String((manifest.bridge as Record<string, unknown>).checksum)
    : null;

  if (!record) issues.push("backup must be an object");
  if (record?.kind !== TODOS_LOCAL_BACKUP_KIND) issues.push(`kind must be ${TODOS_LOCAL_BACKUP_KIND}`);
  if (record?.schema_version !== TODOS_LOCAL_BACKUP_SCHEMA_VERSION) {
    issues.push(`schema_version must be ${TODOS_LOCAL_BACKUP_SCHEMA_VERSION}`);
  }
  if (record?.local_only !== true) issues.push("local_only must be true");
  if (record?.no_network !== true) issues.push("no_network must be true");
  if (!manifest) issues.push("manifest must be an object");
  if (!bridge) issues.push("bridge must be an object");

  const bridgeValidation = validateLocalBridgeBundle(bridge);
  if (!bridgeValidation.ok) issues.push(...bridgeValidation.issues.map((issue) => `bridge: ${issue}`));

  const actualBridgeChecksum = bridge ? sha256(bridge) : null;
  if (expectedBridgeChecksum && actualBridgeChecksum && expectedBridgeChecksum !== actualBridgeChecksum) {
    issues.push("bridge checksum mismatch");
  }

  const withoutChecksum = record ? { ...record } : null;
  if (withoutChecksum) delete withoutChecksum.checksum;
  const actualChecksum = withoutChecksum ? checksumPayload(withoutChecksum as Omit<LocalBackupBundle, "checksum">) : null;
  if (expectedChecksum && actualChecksum && expectedChecksum !== actualChecksum) {
    issues.push("backup checksum mismatch");
  }

  const expectedCounts = manifest?.bridge && typeof manifest.bridge === "object"
    ? (((manifest.bridge as Record<string, unknown>).stats ?? {}) as Partial<Record<keyof TodosLocalBridgeData, number>>)
    : {};
  const actualCounts: Partial<Record<keyof TodosLocalBridgeData, number>> = bridge?.data ? bridgeStats(bridge.data) : {};
  const countMismatches = Object.entries(expectedCounts).filter(([key, count]) => {
    const actual = actualCounts[key as keyof TodosLocalBridgeData];
    return typeof count === "number" && actual !== count;
  });
  if (countMismatches.length > 0) {
    issues.push(`manifest count mismatch: ${countMismatches.map(([key]) => key).join(", ")}`);
  }

  if (manifest?.section_checksums && typeof manifest.section_checksums === "object" && bridge?.data) {
    const actualSections = sectionChecksums(bridge.data);
    const mismatches = Object.entries(manifest.section_checksums as Record<string, unknown>)
      .filter(([key, expected]) => actualSections[key as keyof TodosLocalBridgeData] !== expected);
    if (mismatches.length > 0) issues.push(`section checksum mismatch: ${mismatches.map(([key]) => key).join(", ")}`);
  }

  if (bridge?.schemaVersion !== TODOS_LOCAL_BRIDGE_SCHEMA_VERSION) {
    issues.push(`bridge schemaVersion must be ${TODOS_LOCAL_BRIDGE_SCHEMA_VERSION}`);
  }

  const sqlite = options.check_sqlite === false ? null : sqliteIntegrity(getDatabase(db));
  if (sqlite && !sqlite.ok) warnings.push("current SQLite integrity check did not pass");

  return {
    schema_version: TODOS_LOCAL_BACKUP_SCHEMA_VERSION,
    kind: "hasna.todos.local-backup-verification",
    local_only: true,
    no_network: true,
    verified_at: verifiedAt,
    ok: issues.length === 0,
    checksum_algorithm: LOCAL_BACKUP_CHECKSUM_ALGORITHM,
    checksum: {
      expected: expectedChecksum,
      actual: actualChecksum,
      ok: Boolean(expectedChecksum && actualChecksum && expectedChecksum === actualChecksum),
    },
    bridge_checksum: {
      expected: expectedBridgeChecksum,
      actual: actualBridgeChecksum,
      ok: Boolean(expectedBridgeChecksum && actualBridgeChecksum && expectedBridgeChecksum === actualBridgeChecksum),
    },
    bridge_validation: bridgeValidation,
    sqlite,
    counts: {
      expected: expectedCounts,
      actual: actualCounts,
      ok: countMismatches.length === 0,
    },
    compatible: bridge?.schemaVersion === TODOS_LOCAL_BRIDGE_SCHEMA_VERSION,
    issues,
    warnings,
  };
}

export function restoreLocalBackup(
  backup: LocalBackupBundle,
  options: RestoreLocalBackupOptions = {},
  db?: Database,
): LocalBackupRestoreResult {
  const d = getDatabase(db);
  const verification = verifyLocalBackup(backup, { verified_at: options.verified_at, check_sqlite: true }, d);
  const issues = [...verification.issues];
  let importResult: LocalBridgeImportResult | null = null;
  if (verification.ok) {
    importResult = importLocalBridgeBundle(backup.bridge, {
      dryRun: !options.apply,
      conflictStrategy: options.conflict_strategy ?? "skip",
    }, d);
    if (!importResult.ok) issues.push(...importResult.issues);
  }
  return {
    schema_version: TODOS_LOCAL_BACKUP_SCHEMA_VERSION,
    kind: "hasna.todos.local-backup-restore",
    local_only: true,
    no_network: true,
    restored_at: options.verified_at ?? now(),
    dry_run: !options.apply,
    ok: verification.ok && Boolean(importResult?.ok),
    verification,
    import_result: importResult,
    issues,
  };
}

function count(db: Database, table: string): number {
  const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number } | undefined;
  return row?.count ?? 0;
}

function orphanedRows(db: Database): Record<string, number> {
  return {
    tasks_missing_project: countQuery(db, "SELECT COUNT(*) AS count FROM tasks t WHERE t.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id)"),
    comments_missing_task: countQuery(db, "SELECT COUNT(*) AS count FROM task_comments c WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = c.task_id)"),
    runs_missing_task: countQuery(db, "SELECT COUNT(*) AS count FROM task_runs r WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = r.task_id)"),
    run_events_missing_run: countQuery(db, "SELECT COUNT(*) AS count FROM task_run_events e WHERE NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.id = e.run_id)"),
    run_commands_missing_run: countQuery(db, "SELECT COUNT(*) AS count FROM task_run_commands c WHERE NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.id = c.run_id)"),
    run_artifacts_missing_run: countQuery(db, "SELECT COUNT(*) AS count FROM task_run_artifacts a WHERE NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.id = a.run_id)"),
    dependencies_missing_task: countQuery(db, "SELECT COUNT(*) AS count FROM task_dependencies d WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = d.task_id)"),
    dependencies_missing_dependency: countQuery(db, "SELECT COUNT(*) AS count FROM task_dependencies d WHERE d.depends_on IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = d.depends_on)"),
  };
}

function countQuery(db: Database, sql: string): number {
  try {
    const row = db.query(sql).get() as { count: number } | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

export function checkLocalIntegrity(
  options: { generated_at?: string; project_id?: string; version?: string } = {},
  db?: Database,
): LocalIntegrityReport {
  const d = getDatabase(db);
  const bridge = createLocalBridgeBundle({
    project_id: options.project_id,
    generatedAt: options.generated_at,
    version: options.version ?? getPackageVersion(import.meta.url),
  }, d);
  const bridgeValidation = validateLocalBridgeBundle(bridge);
  const sqlite = sqliteIntegrity(d);
  const orphans = orphanedRows(d);
  const issues: string[] = [];
  const warnings: string[] = [];
  if (!sqlite.ok) issues.push("SQLite integrity check failed");
  if (!bridgeValidation.ok) issues.push(...bridgeValidation.issues.map((issue) => `bridge: ${issue}`));
  const orphanTotal = Object.values(orphans).reduce((sum, value) => sum + value, 0);
  if (orphanTotal > 0) issues.push(`${orphanTotal} orphaned local row(s) detected`);
  if (count(d, "tasks") === 0) warnings.push("no tasks found in local store");
  return {
    schema_version: TODOS_LOCAL_INTEGRITY_SCHEMA_VERSION,
    kind: TODOS_LOCAL_INTEGRITY_KIND,
    local_only: true,
    no_network: true,
    generated_at: options.generated_at ?? now(),
    database_path: getDatabasePath(),
    sqlite,
    bridge_validation: bridgeValidation,
    counts: bridge.stats,
    orphaned_rows: orphans,
    ok: issues.length === 0,
    issues,
    warnings,
  };
}
