import type { Database } from "bun:sqlite";
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getDatabase, getDatabasePath, now } from "../db/database.js";
import { MIGRATIONS } from "../db/migrations.js";
import { ensureSchema, runMigrations } from "../db/schema.js";
import { isValidRecurrenceRule } from "./recurrence.js";

export type DoctorSeverity = "info" | "warn" | "error";

export interface DoctorCheck {
  severity: DoctorSeverity;
  type: string;
  message: string;
  count?: number;
  repairable?: boolean;
}

export interface DoctorRepair {
  type: string;
  message: string;
  applied: boolean;
  count?: number;
}

export interface DoctorBackup {
  path: string;
  files: string[];
}

export interface DoctorSummary {
  errors: number;
  warnings: number;
  infos: number;
  repairable: number;
  applied: number;
}

export interface DoctorResult {
  ok: boolean;
  dry_run: boolean;
  database_path: string;
  migration: {
    current: number;
    expected: number;
  };
  backup?: DoctorBackup;
  checks: DoctorCheck[];
  repairs: DoctorRepair[];
  summary: DoctorSummary;
}

export interface RunTodosDoctorOptions {
  db?: Database;
  dbPath?: string;
  apply?: boolean;
}

interface JsonCell {
  table: string;
  column: string;
  rowid: number;
}

interface DuplicateIndex {
  table: string;
  duplicate: string;
  kept: string;
  columns: string[];
}

const REQUIRED_TABLES = [
  "_migrations",
  "projects",
  "tasks",
  "plans",
  "agents",
  "task_dependencies",
  "task_comments",
  "task_runs",
  "task_run_events",
  "task_run_commands",
  "task_run_artifacts",
] as const;

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function getTableColumns(db: Database, table: string): Set<string> {
  try {
    const rows = db.query(`PRAGMA table_info(${quoteIdent(table)})`).all() as { name: string }[];
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

function countQuery(db: Database, sql: string): number {
  try {
    const row = db.query(sql).get() as { count: number } | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

function getMigrationLevel(db: Database): number {
  try {
    const row = db.query("SELECT MAX(id) as max_id FROM _migrations").get() as { max_id: number | null } | undefined;
    return row?.max_id ?? 0;
  } catch {
    return 0;
  }
}

function addCheck(checks: DoctorCheck[], check: DoctorCheck): void {
  checks.push(check);
}

function listUserTables(db: Database): string[] {
  return (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((row) => row.name)
    .sort();
}

function findCorruptJsonMetadata(db: Database): JsonCell[] {
  const corrupt: JsonCell[] = [];
  for (const table of listUserTables(db)) {
    const columns = getTableColumns(db, table);
    if (!columns.has("metadata")) continue;
    const rows = db.query(`SELECT rowid, metadata FROM ${quoteIdent(table)} WHERE metadata IS NOT NULL AND metadata != ''`).all() as { rowid: number; metadata: string }[];
    for (const row of rows) {
      try {
        JSON.parse(row.metadata);
      } catch {
        corrupt.push({ table, column: "metadata", rowid: row.rowid });
      }
    }
  }
  return corrupt;
}

function getIndexColumns(db: Database, indexName: string): string[] {
  return (db.query(`PRAGMA index_info(${quoteIdent(indexName)})`).all() as { name: string }[])
    .map((row) => row.name)
    .filter(Boolean);
}

function findDuplicateIndexes(db: Database): DuplicateIndex[] {
  const duplicates: DuplicateIndex[] = [];
  for (const table of listUserTables(db)) {
    const indexes = db.query(`PRAGMA index_list(${quoteIdent(table)})`).all() as { name: string; unique: number; origin: string }[];
    const groups = new Map<string, { name: string; origin: string; columns: string[] }[]>();
    for (const index of indexes) {
      if (index.origin === "pk" || index.name.startsWith("sqlite_autoindex")) continue;
      const columns = getIndexColumns(db, index.name);
      if (columns.length === 0) continue;
      const key = `${index.unique}:${columns.join(",")}`;
      const current = groups.get(key) ?? [];
      current.push({ name: index.name, origin: index.origin, columns });
      groups.set(key, current);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [kept, ...rest] = group;
      for (const duplicate of rest) {
        duplicates.push({ table, duplicate: duplicate.name, kept: kept!.name, columns: duplicate.columns });
      }
    }
  }
  return duplicates;
}

function findMissingProjectRoots(db: Database): number {
  if (!tableExists(db, "projects")) return 0;
  let missing = 0;
  const rows = db.query("SELECT path FROM projects WHERE path IS NOT NULL AND path != ''").all() as { path: string }[];
  for (const row of rows) {
    if (/^[a-z]+:\/\//i.test(row.path)) continue;
    if (!row.path.startsWith("/")) continue;
    if (!existsSync(row.path)) missing++;
  }
  return missing;
}

function addTaskStateChecks(db: Database, checks: DoctorCheck[]): void {
  if (!tableExists(db, "tasks")) return;
  const columns = getTableColumns(db, "tasks");
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  if (columns.has("updated_at") && columns.has("status")) {
    const staleTasks = countQuery(db, `SELECT COUNT(*) as count FROM tasks WHERE status = 'in_progress' AND updated_at < '${staleCutoff}'`);
    if (staleTasks > 0) {
      addCheck(checks, {
        severity: "warn",
        type: "stale_tasks",
        message: `${staleTasks} tasks stuck in_progress for more than 30 minutes`,
        count: staleTasks,
        repairable: false,
      });
    }
  }

  if (columns.has("recurrence_rule") && columns.has("status")) {
    const dueAtSelect = columns.has("due_at") ? "due_at" : "NULL as due_at";
    const recurring = db.query(`SELECT recurrence_rule, ${dueAtSelect} FROM tasks WHERE status IN ('pending', 'in_progress') AND recurrence_rule IS NOT NULL AND recurrence_rule != ''`).all() as { recurrence_rule: string; due_at: string | null }[];
    const invalidRecurrence = recurring.filter((task) => !isValidRecurrenceRule(task.recurrence_rule));
    if (invalidRecurrence.length > 0) {
      addCheck(checks, {
        severity: "error",
        type: "invalid_recurrence",
        message: `${invalidRecurrence.length} tasks have invalid recurrence rules`,
        count: invalidRecurrence.length,
        repairable: false,
      });
    }

    const nowIso = new Date().toISOString();
    const overdueRecurring = recurring.filter((task) => task.due_at !== null && task.due_at < nowIso);
    if (overdueRecurring.length > 0) {
      addCheck(checks, {
        severity: "warn",
        type: "overdue_recurring",
        message: `${overdueRecurring.length} recurring tasks are past due`,
        count: overdueRecurring.length,
        repairable: false,
      });
    }
  }
}

function databasePermissionsAreUnsafe(dbPath: string): boolean {
  if (dbPath === ":memory:" || dbPath.startsWith("file::memory:")) return false;
  try {
    return (statSync(dbPath).mode & 0o077) !== 0;
  } catch {
    return false;
  }
}

function createBackup(dbPath: string): DoctorBackup | undefined {
  if (dbPath === ":memory:" || dbPath.startsWith("file::memory:")) return undefined;
  if (!existsSync(dbPath)) return undefined;
  const stamp = now().replace(/[:.]/g, "-");
  const backupDir = join(dirname(dbPath), `${basename(dbPath)}.backup-${stamp}`);
  const files: string[] = [];
  mkdirSync(backupDir, { recursive: true });
  for (const source of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (!existsSync(source)) continue;
    const target = join(backupDir, basename(source));
    copyFileSync(source, target);
    files.push(target);
  }
  return files.length > 0 ? { path: backupDir, files } : undefined;
}

function pushRepair(repairs: DoctorRepair[], type: string, message: string, applied: boolean, count?: number): void {
  repairs.push({ type, message, applied, count });
}

function summarize(checks: DoctorCheck[], repairs: DoctorRepair[]): DoctorSummary {
  return {
    errors: checks.filter((check) => check.severity === "error").length,
    warnings: checks.filter((check) => check.severity === "warn").length,
    infos: checks.filter((check) => check.severity === "info").length,
    repairable: checks.filter((check) => check.repairable).length,
    applied: repairs.filter((repair) => repair.applied).length,
  };
}

function deleteOrphans(db: Database, table: string, where: string): number {
  const before = countQuery(db, `SELECT COUNT(*) as count FROM ${table} WHERE ${where}`);
  if (before > 0) db.run(`DELETE FROM ${table} WHERE ${where}`);
  return before;
}

export function runTodosDoctor(options: RunTodosDoctorOptions = {}): DoctorResult {
  const db = getDatabase(options.db);
  const dbPath = options.dbPath ?? getDatabasePath();
  const apply = options.apply === true;
  const checks: DoctorCheck[] = [];
  const repairs: DoctorRepair[] = [];

  const migrationCurrent = getMigrationLevel(db);
  const migrationExpected = MIGRATIONS.length;
  if (migrationCurrent < migrationExpected) {
    addCheck(checks, {
      severity: "error",
      type: "migration_level",
      message: `Migration level ${migrationCurrent}; expected ${migrationExpected}`,
      repairable: true,
    });
  } else {
    addCheck(checks, {
      severity: "info",
      type: "migration_level",
      message: `Schema at migration ${migrationCurrent}`,
    });
  }

  const missingTables = REQUIRED_TABLES.filter((table) => !tableExists(db, table));
  if (missingTables.length > 0) {
    addCheck(checks, {
      severity: "error",
      type: "missing_schema_tables",
      message: `Missing schema tables: ${missingTables.join(", ")}`,
      count: missingTables.length,
      repairable: true,
    });
  }

  const orphanedParents = tableExists(db, "tasks")
    ? countQuery(db, "SELECT COUNT(*) as count FROM tasks t WHERE t.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_id)")
    : 0;
  if (orphanedParents > 0) {
    addCheck(checks, {
      severity: "error",
      type: "orphaned_task_parents",
      message: `${orphanedParents} tasks reference missing parent tasks`,
      count: orphanedParents,
      repairable: true,
    });
  }

  const orphanedDependencies = tableExists(db, "task_dependencies") && tableExists(db, "tasks")
    ? countQuery(db, "SELECT COUNT(*) as count FROM task_dependencies d WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = d.task_id) OR NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = d.depends_on)")
    : 0;
  if (orphanedDependencies > 0) {
    addCheck(checks, {
      severity: "error",
      type: "orphaned_task_dependencies",
      message: `${orphanedDependencies} dependency rows reference missing tasks`,
      count: orphanedDependencies,
      repairable: true,
    });
  }

  const orphanTables: Array<[string, string]> = [
    ["task_comments", "NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_comments.task_id)"],
    ["task_runs", "NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_runs.task_id)"],
    ["task_run_events", "NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_run_events.task_id) OR NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.id = task_run_events.run_id)"],
    ["task_run_commands", "NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_run_commands.task_id) OR NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.id = task_run_commands.run_id)"],
    ["task_run_artifacts", "NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_run_artifacts.task_id) OR NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.id = task_run_artifacts.run_id)"],
  ];
  let orphanedRows = 0;
  for (const [table, where] of orphanTables) {
    if (!tableExists(db, table)) continue;
    orphanedRows += countQuery(db, `SELECT COUNT(*) as count FROM ${table} WHERE ${where}`);
  }
  if (orphanedRows > 0) {
    addCheck(checks, {
      severity: "error",
      type: "orphaned_child_rows",
      message: `${orphanedRows} child rows reference missing tasks or runs`,
      count: orphanedRows,
      repairable: true,
    });
  }

  addTaskStateChecks(db, checks);

  const corruptJson = findCorruptJsonMetadata(db);
  if (corruptJson.length > 0) {
    addCheck(checks, {
      severity: "error",
      type: "corrupt_json_metadata",
      message: `${corruptJson.length} metadata values are not valid JSON`,
      count: corruptJson.length,
      repairable: true,
    });
  }

  const duplicateIndexes = findDuplicateIndexes(db);
  if (duplicateIndexes.length > 0) {
    addCheck(checks, {
      severity: "warn",
      type: "duplicate_indexes",
      message: `${duplicateIndexes.length} duplicate index definitions found`,
      count: duplicateIndexes.length,
      repairable: true,
    });
  }

  const missingProjectRoots = findMissingProjectRoots(db);
  if (missingProjectRoots > 0) {
    addCheck(checks, {
      severity: "warn",
      type: "missing_project_roots",
      message: `${missingProjectRoots} project paths do not exist on this machine`,
      count: missingProjectRoots,
      repairable: false,
    });
  }

  const unsafePermissions = databasePermissionsAreUnsafe(dbPath);
  addCheck(checks, unsafePermissions
    ? {
      severity: "warn",
      type: "database_permissions",
      message: "Database file is readable or writable by group/others",
      repairable: true,
    }
    : {
      severity: "info",
      type: "database_permissions",
      message: "Database file permissions are private",
    });

  let backup: DoctorBackup | undefined;
  const hasRepairableIssue = checks.some((check) => check.repairable && check.severity !== "info");
  if (apply && hasRepairableIssue) {
    backup = createBackup(dbPath);
    if (backup) pushRepair(repairs, "backup_created", `Created backup at ${backup.path}`, true, backup.files.length);
    else pushRepair(repairs, "backup_created", "Backup skipped for in-memory or missing database path", false, 0);

    if (migrationCurrent < migrationExpected || missingTables.length > 0) {
      runMigrations(db);
      ensureSchema(db);
      pushRepair(repairs, "schema_repair", "Ran migration and schema safety net", true);
    }

    if (orphanedParents > 0) {
      db.run("UPDATE tasks SET parent_id = NULL WHERE parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = tasks.parent_id)");
      pushRepair(repairs, "orphaned_task_parents", "Cleared missing parent references", true, orphanedParents);
    }

    if (orphanedDependencies > 0 && tableExists(db, "task_dependencies")) {
      const count = deleteOrphans(db, "task_dependencies", "NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_dependencies.task_id) OR NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_dependencies.depends_on)");
      pushRepair(repairs, "orphaned_task_dependencies", "Deleted dependency rows referencing missing tasks", true, count);
    }

    for (const [table, where] of orphanTables) {
      if (!tableExists(db, table)) continue;
      const count = deleteOrphans(db, table, where);
      if (count > 0) pushRepair(repairs, "orphaned_child_rows", `Deleted orphaned rows from ${table}`, true, count);
    }

    if (corruptJson.length > 0) {
      for (const cell of corruptJson) {
        db.run(`UPDATE ${quoteIdent(cell.table)} SET ${quoteIdent(cell.column)} = '{}' WHERE rowid = ?`, [cell.rowid]);
      }
      pushRepair(repairs, "corrupt_json_metadata", "Reset invalid metadata JSON values to {}", true, corruptJson.length);
    }

    if (duplicateIndexes.length > 0) {
      let dropped = 0;
      for (const duplicate of duplicateIndexes) {
        db.run(`DROP INDEX IF EXISTS ${quoteIdent(duplicate.duplicate)}`);
        dropped++;
      }
      pushRepair(repairs, "duplicate_indexes", "Dropped duplicate non-primary indexes", true, dropped);
    }

    if (unsafePermissions) {
      try {
        chmodSync(dbPath, 0o600);
        pushRepair(repairs, "database_permissions", "Changed database file mode to 0600", true);
      } catch (error) {
        pushRepair(repairs, "database_permissions", error instanceof Error ? error.message : "Failed to repair database permissions", false);
      }
    }
  }

  const finalChecks = apply && hasRepairableIssue ? runTodosDoctor({ db, dbPath, apply: false }).checks : checks;
  const summary = summarize(finalChecks, repairs);
  return {
    ok: !finalChecks.some((check) => check.severity === "error"),
    dry_run: !apply,
    database_path: dbPath,
    migration: { current: getMigrationLevel(db), expected: migrationExpected },
    backup,
    checks: finalChecks,
    repairs,
    summary,
  };
}
