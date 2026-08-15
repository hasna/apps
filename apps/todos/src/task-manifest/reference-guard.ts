import type { Database } from "bun:sqlite";

export interface TodosTaskManifestManagedReferences {
  plan_id: string;
  task_ids: string[];
  dependency_ids: string[];
  comment_ids: string[];
  verification_ids: string[];
}

export interface TodosTaskManifestForeignReference {
  surface: string;
  field: string;
  target: "tasks" | "plans";
  on_delete: string;
}

interface SqliteForeignKeyRow {
  table: string;
  from: string;
  to: string;
  on_delete: string;
}

function quoteSqliteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function sqliteManagedReferencePredicate(
  table: string,
  field: string,
  target: "tasks" | "plans",
  managed: TodosTaskManifestManagedReferences,
): { sql: string; values: string[] } | null {
  const taskPlaceholders = placeholders(managed.task_ids.length);
  if (table === "tasks" && field === "plan_id" && target === "plans") {
    return {
      sql: `id IN (${taskPlaceholders})`,
      values: managed.task_ids,
    };
  }
  if (table === "task_dependencies" && target === "tasks"
    && (field === "task_id" || field === "depends_on")) {
    return {
      sql: `task_id IN (${taskPlaceholders}) AND depends_on IN (${taskPlaceholders})`,
      values: [...managed.task_ids, ...managed.task_ids],
    };
  }
  if (table === "task_comments" && field === "task_id" && target === "tasks") {
    return managed.comment_ids.length > 0
      ? { sql: `id IN (${placeholders(managed.comment_ids.length)})`, values: managed.comment_ids }
      : { sql: "0", values: [] };
  }
  if (table === "task_verifications" && field === "task_id" && target === "tasks") {
    return managed.verification_ids.length > 0
      ? { sql: `id IN (${placeholders(managed.verification_ids.length)})`, values: managed.verification_ids }
      : { sql: "0", values: [] };
  }
  if (table === "task_tags" && field === "task_id" && target === "tasks") {
    return {
      sql: `task_id IN (${taskPlaceholders})`,
      values: managed.task_ids,
    };
  }
  return null;
}

/**
 * Discover every live SQLite foreign-key surface that can be changed by deleting
 * a manifest-owned task or plan. This reads the installed package schema instead
 * of maintaining a second, incomplete table list.
 */
export function findSqliteTaskManifestForeignReference(
  db: Database,
  managed: TodosTaskManifestManagedReferences,
): TodosTaskManifestForeignReference | null {
  const tables = db.query(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>;
  for (const { name: table } of tables) {
    const foreignKeys = db.query(`PRAGMA foreign_key_list(${quoteSqliteIdentifier(table)})`).all() as SqliteForeignKeyRow[];
    for (const foreignKey of foreignKeys) {
      if (foreignKey.table !== "tasks" && foreignKey.table !== "plans") continue;
      const target = foreignKey.table;
      const targetIds = target === "tasks" ? managed.task_ids : [managed.plan_id];
      const owned = sqliteManagedReferencePredicate(table, foreignKey.from, target, managed);
      const sql = `SELECT 1 AS found FROM ${quoteSqliteIdentifier(table)}
        WHERE ${quoteSqliteIdentifier(foreignKey.from)} IN (${placeholders(targetIds.length)})
        ${owned ? `AND NOT (${owned.sql})` : ""}
        LIMIT 1`;
      if (db.query(sql).get(...targetIds, ...(owned?.values ?? []))) {
        return {
          surface: table,
          field: foreignKey.from,
          target,
          on_delete: foreignKey.on_delete.toUpperCase(),
        };
      }
    }
  }
  return null;
}

/**
 * PostgreSQL stores domain rows as JSONB without foreign keys. Search every
 * non-managed live payload for an exact managed task/plan identifier, so new
 * supported reference surfaces fail closed without another compensation patch.
 */
export function postgresTaskManifestForeignReferenceSql(tableName: string): string {
  return `SELECT object_type, object_id
    FROM ${tableName}
    WHERE service = $1 AND deleted_at IS NULL
      AND NOT (object_type = 'plans' AND object_id = $2)
      AND NOT (object_type = 'tasks' AND object_id IN (
        SELECT value FROM jsonb_array_elements_text($3::jsonb)
      ))
      AND NOT (object_type = 'dependencies' AND object_id IN (
        SELECT value FROM jsonb_array_elements_text($4::jsonb)
      ))
      AND NOT (object_type = 'comments' AND object_id IN (
        SELECT value FROM jsonb_array_elements_text($5::jsonb)
      ))
      AND NOT (object_type = 'verifications' AND object_id IN (
        SELECT value FROM jsonb_array_elements_text($6::jsonb)
      ))
      AND jsonb_path_exists(
        payload,
        '$.** ? (@ == $refs[*])',
        jsonb_build_object('refs', $7::jsonb)
      )
    LIMIT 1`;
}
