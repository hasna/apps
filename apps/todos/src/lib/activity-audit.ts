/**
 * Append-only activity log for tasks, projects, plans, runs, and comments.
 * Local SQLite storage with redaction and export/import compatibility.
 */

import { hostname } from "node:os";
import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { redactText, redactExportRecord } from "./secret-redaction.js";

export const ACTIVITY_LOG_SCHEMA = "todos.activity_log.v1";

export const ACTIVITY_ENTITY_TYPES = [
  "task",
  "project",
  "plan",
  "agent_run",
  "run_record",
  "comment",
  "session",
] as const;

export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

export interface ActivityRecord {
  schema_version: typeof ACTIVITY_LOG_SCHEMA;
  id: string;
  entity_type: ActivityEntityType;
  entity_id: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_id: string | null;
  session_id: string | null;
  machine_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface LogActivityInput {
  entity_type: ActivityEntityType;
  entity_id: string;
  action: string;
  field?: string;
  old_value?: string | null;
  new_value?: string | null;
  actor_id?: string;
  session_id?: string;
  machine_id?: string;
  metadata?: Record<string, unknown>;
  /** Override timestamp (tests/internal) */
  created_at?: string;
}

export interface ListActivityFilter {
  entity_type?: ActivityEntityType;
  entity_id?: string;
  actor_id?: string;
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

export interface ActivityExportBundle {
  schema_version: typeof ACTIVITY_LOG_SCHEMA;
  exported_at: string;
  records: ActivityRecord[];
}

function getMachineId(): string {
  return process.env["TODOS_MACHINE_ID"] || hostname();
}

function rowToActivity(row: Record<string, unknown>): ActivityRecord {
  return {
    schema_version: ACTIVITY_LOG_SCHEMA,
    id: row.id as string,
    entity_type: row.entity_type as ActivityEntityType,
    entity_id: row.entity_id as string,
    action: row.action as string,
    field: (row.field as string) ?? null,
    old_value: (row.old_value as string) ?? null,
    new_value: (row.new_value as string) ?? null,
    actor_id: (row.actor_id as string) ?? null,
    session_id: (row.session_id as string) ?? null,
    machine_id: (row.machine_id as string) ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    created_at: row.created_at as string,
  };
}

export function redactActivityRecord(record: ActivityRecord): ActivityRecord {
  return {
    ...record,
    old_value: record.old_value ? redactText(record.old_value) : null,
    new_value: record.new_value ? redactText(record.new_value) : null,
    metadata: redactExportRecord(record.metadata) as Record<string, unknown>,
  };
}

export function logActivity(input: LogActivityInput, db?: Database): ActivityRecord {
  const d = db || getDatabase();
  const id = uuid();
  const ts = input.created_at ?? now();
  const machineId = input.machine_id ?? getMachineId();

  d.run(
    `INSERT INTO activity_log (
      id, entity_type, entity_id, action, field, old_value, new_value,
      actor_id, session_id, machine_id, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.entity_type,
      input.entity_id,
      input.action,
      input.field ?? null,
      input.old_value ?? null,
      input.new_value ?? null,
      input.actor_id ?? null,
      input.session_id ?? null,
      machineId,
      JSON.stringify(input.metadata ?? {}),
      ts,
    ],
  );

  return getActivityRecord(id, d)!;
}

export function getActivityRecord(id: string, db?: Database): ActivityRecord | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM activity_log WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToActivity(row) : null;
}

export function listActivity(filter: ListActivityFilter = {}, db?: Database): ActivityRecord[] {
  const d = db || getDatabase();
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filter.entity_type) {
    conditions.push("entity_type = ?");
    params.push(filter.entity_type);
  }
  if (filter.entity_id) {
    conditions.push("entity_id = ?");
    params.push(filter.entity_id);
  }
  if (filter.actor_id) {
    conditions.push("actor_id = ?");
    params.push(filter.actor_id);
  }
  if (filter.action) {
    conditions.push("action = ?");
    params.push(filter.action);
  }
  if (filter.since) {
    conditions.push("created_at >= ?");
    params.push(filter.since);
  }
  if (filter.until) {
    conditions.push("created_at <= ?");
    params.push(filter.until);
  }

  const order = filter.order === "asc" ? "ASC" : "DESC";
  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;
  const sql = `SELECT * FROM activity_log WHERE ${conditions.join(" AND ")} ORDER BY created_at ${order}, rowid ${order} LIMIT ? OFFSET ?`;
  const rows = d.query(sql).all(...[...params, limit, offset] as any) as Record<string, unknown>[];
  return rows.map(rowToActivity);
}

export function getActivityTimeline(
  entityType: ActivityEntityType,
  entityId: string,
  db?: Database,
): ActivityRecord[] {
  return listActivity({ entity_type: entityType, entity_id: entityId, order: "asc", limit: 500 }, db);
}

export function exportActivityLog(filter: ListActivityFilter = {}, db?: Database): ActivityExportBundle {
  const records = listActivity({ ...filter, limit: filter.limit ?? 1000, order: "asc" }, db)
    .map(redactActivityRecord);
  return {
    schema_version: ACTIVITY_LOG_SCHEMA,
    exported_at: now(),
    records,
  };
}

export function importActivityLog(
  bundle: ActivityExportBundle,
  options: { skip_existing?: boolean } = {},
  db?: Database,
): { imported: number; skipped: number } {
  if (bundle.schema_version !== ACTIVITY_LOG_SCHEMA) {
    throw new Error(`Unsupported activity bundle schema: ${bundle.schema_version}`);
  }

  const d = db || getDatabase();
  let imported = 0;
  let skipped = 0;

  const tx = d.transaction(() => {
    for (const record of bundle.records) {
      if (options.skip_existing) {
        const exists = d.query("SELECT 1 FROM activity_log WHERE id = ?").get(record.id);
        if (exists) {
          skipped++;
          continue;
        }
      }

      d.run(
        `INSERT OR REPLACE INTO activity_log (
          id, entity_type, entity_id, action, field, old_value, new_value,
          actor_id, session_id, machine_id, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.entity_type,
          record.entity_id,
          record.action,
          record.field,
          record.old_value,
          record.new_value,
          record.actor_id,
          record.session_id,
          record.machine_id,
          JSON.stringify(record.metadata ?? {}),
          record.created_at,
        ],
      );
      imported++;
    }
  });

  tx();
  return { imported, skipped };
}

export function formatActivityRecordText(record: ActivityRecord): string {
  const parts = [
    `[${record.created_at}] ${record.entity_type}:${record.entity_id.slice(0, 8)}`,
    `${record.action}${record.field ? `.${record.field}` : ""}`,
  ];
  if (record.actor_id) parts.push(`by ${record.actor_id}`);
  if (record.old_value != null || record.new_value != null) {
    parts.push(`${record.old_value ?? "∅"} → ${record.new_value ?? "∅"}`);
  }
  return parts.join(" ");
}
