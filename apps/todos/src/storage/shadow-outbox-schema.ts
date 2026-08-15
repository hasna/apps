import type { Database } from "bun:sqlite";
import type { TodosPostgresSyncRecordType } from "./postgres-sync.js";

/**
 * Leaf module (imports only `bun:sqlite` + a type): the durable outbox DDL and
 * capture triggers. Kept dependency-free so `getDatabase()` can install capture
 * synchronously on the hot path without dragging in the storage-adapter chain
 * (which would create an import cycle through `local-sqlite`).
 */

/** SQLite tables that carry shadow-mirrored domain objects. */
export const SHADOW_TRIGGER_TABLES: Array<{
  table: string;
  objectType: TodosPostgresSyncRecordType;
  deletes: boolean;
}> = [
  { table: "tasks", objectType: "tasks", deletes: true },
  { table: "projects", objectType: "projects", deletes: true },
  { table: "project_machine_paths", objectType: "project_machine_paths", deletes: true },
  { table: "plans", objectType: "plans", deletes: true },
  { table: "agents", objectType: "agents", deletes: false },
  { table: "task_lists", objectType: "task_lists", deletes: true },
  { table: "task_templates", objectType: "templates", deletes: true },
  { table: "task_history", objectType: "audit_history", deletes: false },
];

/**
 * Install the durable outbox table + capture triggers. Pure SQLite, no network,
 * no cloud client required — this is the piece that makes the shadow capture
 * EVERY local write path, and it is safe to run on every `getDatabase()` call.
 */
export function installShadowOutboxSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS shadow_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    op TEXT NOT NULL,
    enqueued_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    revision INTEGER NOT NULL DEFAULT 0
  )`);
  ensureColumn(db, "shadow_outbox", "revision", "INTEGER NOT NULL DEFAULT 0");
  // Coalesce: keep at most one pending op per object so the queue tracks the
  // latest state instead of growing unbounded under hot write loops.
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS shadow_outbox_pending_uq
       ON shadow_outbox(object_type, object_id) WHERE status='pending'`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS shadow_outbox_ready_idx
       ON shadow_outbox(status, next_attempt_at)`,
  );

  for (const { table, objectType, deletes } of SHADOW_TRIGGER_TABLES) {
    // Guard: only install triggers for tables that actually exist in this DB.
    const exists = db
      .query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    if (!exists) continue;

    const insertTrigger = `shadow_ob_${table}_ai`;
    const updateTrigger = `shadow_ob_${table}_au`;
    db.run(`DROP TRIGGER IF EXISTS ${insertTrigger}`);
    db.run(`DROP TRIGGER IF EXISTS ${updateTrigger}`);
    db.run(upsertTriggerSql(insertTrigger, table, objectType, "INSERT", "NEW"));
    db.run(upsertTriggerSql(updateTrigger, table, objectType, "UPDATE", "NEW"));
    if (deletes) {
      const deleteTrigger = `shadow_ob_${table}_ad`;
      db.run(`DROP TRIGGER IF EXISTS ${deleteTrigger}`);
      db.run(deleteTriggerSql(deleteTrigger, table, objectType));
    }
  }
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function upsertTriggerSql(
  name: string,
  table: string,
  objectType: string,
  event: "INSERT" | "UPDATE",
  row: "NEW" | "OLD",
): string {
  return `CREATE TRIGGER IF NOT EXISTS ${name}
    AFTER ${event} ON ${table}
    BEGIN
      INSERT INTO shadow_outbox(object_type, object_id, op, enqueued_at, attempts, next_attempt_at, last_error, status, revision)
      VALUES('${objectType}', ${row}.id, 'upsert', CAST(strftime('%s','now') AS INTEGER) * 1000, 0, 0, NULL, 'pending', 0)
      ON CONFLICT(object_type, object_id) WHERE status='pending'
      DO UPDATE SET op='upsert', enqueued_at=excluded.enqueued_at, attempts=0, next_attempt_at=0, last_error=NULL, revision=shadow_outbox.revision + 1;
    END`;
}

function deleteTriggerSql(name: string, table: string, objectType: string): string {
  return `CREATE TRIGGER IF NOT EXISTS ${name}
    AFTER DELETE ON ${table}
    BEGIN
      INSERT INTO shadow_outbox(object_type, object_id, op, enqueued_at, attempts, next_attempt_at, last_error, status, revision)
      VALUES('${objectType}', OLD.id, 'delete', CAST(strftime('%s','now') AS INTEGER) * 1000, 0, 0, NULL, 'pending', 0)
      ON CONFLICT(object_type, object_id) WHERE status='pending'
      DO UPDATE SET op='delete', enqueued_at=excluded.enqueued_at, attempts=0, next_attempt_at=0, last_error=NULL, revision=shadow_outbox.revision + 1;
    END`;
}
