import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";
import { getTaskLabels } from "./labels.js";

export const CUSTOM_FIELD_TYPES = ["text", "number", "boolean", "date", "enum"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomFieldDefinition {
  id: string;
  project_id: string | null;
  name: string;
  slug: string;
  field_type: CustomFieldType;
  options: string[];
  required: boolean;
  default_value: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskCustomFieldValue {
  field_id: string;
  field_name: string;
  field_type: CustomFieldType;
  value: string | number | boolean | null;
}

interface FieldDefRow {
  id: string;
  project_id: string | null;
  name: string;
  slug: string;
  field_type: string;
  options: string | null;
  required: number;
  default_value: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function rowToDef(row: FieldDefRow): CustomFieldDefinition {
  return {
    ...row,
    field_type: row.field_type as CustomFieldType,
    options: row.options ? JSON.parse(row.options) : [],
    required: row.required === 1,
  };
}

export interface CreateCustomFieldInput {
  name: string;
  project_id?: string;
  field_type: CustomFieldType;
  options?: string[];
  required?: boolean;
  default_value?: string;
  sort_order?: number;
}

export function createCustomFieldDefinition(input: CreateCustomFieldInput, db?: Database): CustomFieldDefinition {
  if (!CUSTOM_FIELD_TYPES.includes(input.field_type)) {
    throw new Error(`Invalid field type: ${input.field_type}`);
  }
  if (input.field_type === "enum" && (!input.options || input.options.length === 0)) {
    throw new Error("Enum fields require options");
  }

  const d = getDatabase(db);
  const id = uuid();
  const ts = now();
  const slug = slugify(input.name);

  d.run(
    `INSERT INTO custom_field_definitions (
      id, project_id, name, slug, field_type, options, required, default_value, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.project_id ?? null,
      input.name.trim(),
      slug,
      input.field_type,
      JSON.stringify(input.options ?? []),
      input.required ? 1 : 0,
      input.default_value ?? null,
      input.sort_order ?? 0,
      ts,
      ts,
    ],
  );

  return rowToDef(d.query("SELECT * FROM custom_field_definitions WHERE id = ?").get(id) as FieldDefRow);
}

export function getCustomFieldDefinition(idOrSlug: string, db?: Database): CustomFieldDefinition | null {
  const d = getDatabase(db);
  let row = d.query("SELECT * FROM custom_field_definitions WHERE id = ?").get(idOrSlug) as FieldDefRow | null;
  if (!row) row = d.query("SELECT * FROM custom_field_definitions WHERE slug = ?").get(slugify(idOrSlug)) as FieldDefRow | null;
  return row ? rowToDef(row) : null;
}

export function listCustomFieldDefinitions(projectId?: string, db?: Database): CustomFieldDefinition[] {
  const d = getDatabase(db);
  const rows = projectId
    ? d.query("SELECT * FROM custom_field_definitions WHERE project_id IS NULL OR project_id = ? ORDER BY sort_order, name").all(projectId) as FieldDefRow[]
    : d.query("SELECT * FROM custom_field_definitions ORDER BY sort_order, name").all() as FieldDefRow[];
  return rows.map(rowToDef);
}

export function deleteCustomFieldDefinition(idOrSlug: string, db?: Database): boolean {
  const d = getDatabase(db);
  const def = getCustomFieldDefinition(idOrSlug, d);
  if (!def) return false;
  d.run("DELETE FROM task_custom_field_values WHERE field_id = ?", [def.id]);
  return d.run("DELETE FROM custom_field_definitions WHERE id = ?", [def.id]).changes > 0;
}

function coerceValue(type: CustomFieldType, raw: string): string | number | boolean | null {
  if (raw === "" || raw === "null") return null;
  switch (type) {
    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new Error(`Invalid number: ${raw}`);
      return n;
    }
    case "boolean":
      if (raw === "true" || raw === "1") return true;
      if (raw === "false" || raw === "0") return false;
      throw new Error(`Invalid boolean: ${raw}`);
    default:
      return raw;
  }
}

function serializeValue(value: string | number | boolean | null): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function setTaskCustomField(
  taskId: string,
  fieldIdOrSlug: string,
  value: string | number | boolean | null,
  db?: Database,
): TaskCustomFieldValue {
  const d = getDatabase(db);
  const def = getCustomFieldDefinition(fieldIdOrSlug, d);
  if (!def) throw new Error(`Custom field not found: ${fieldIdOrSlug}`);

  const serialized = serializeValue(typeof value === "string" ? coerceValue(def.field_type, value) as string | number | boolean | null : value);
  if (def.required && (serialized === null || serialized === "")) {
    throw new Error(`Field '${def.name}' is required`);
  }
  if (def.field_type === "enum" && serialized && !def.options.includes(serialized)) {
    throw new Error(`Value must be one of: ${def.options.join(", ")}`);
  }

  d.run(
    `INSERT INTO task_custom_field_values (task_id, field_id, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(task_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [taskId, def.id, serialized, now()],
  );

  return {
    field_id: def.id,
    field_name: def.name,
    field_type: def.field_type,
    value: serialized === null ? null : coerceValue(def.field_type, serialized),
  };
}

export function getTaskCustomFields(taskId: string, db?: Database): TaskCustomFieldValue[] {
  const d = getDatabase(db);
  const rows = d.query(
    `SELECT d.*, v.value AS field_value
     FROM custom_field_definitions d
     LEFT JOIN task_custom_field_values v ON v.field_id = d.id AND v.task_id = ?
     ORDER BY d.sort_order, d.name`,
  ).all(taskId) as Array<FieldDefRow & { field_value: string | null }>;

  return rows
    .filter((r) => r.field_value !== null || r.default_value !== null)
    .map((r) => {
      const def = rowToDef(r);
      const raw = r.field_value ?? r.default_value;
      return {
        field_id: def.id,
        field_name: def.name,
        field_type: def.field_type,
        value: raw === null ? null : coerceValue(def.field_type, raw),
      };
    });
}

export function setTaskPriorityMeta(
  taskId: string,
  input: { priority_score?: number; priority_reason?: string },
  db?: Database,
): void {
  const d = getDatabase(db);
  if (input.priority_score !== undefined) {
    if (input.priority_score < 0 || input.priority_score > 100) {
      throw new Error("priority_score must be between 0 and 100");
    }
    d.run("UPDATE tasks SET priority_score = ?, updated_at = ? WHERE id = ?", [input.priority_score, now(), taskId]);
  }
  if (input.priority_reason !== undefined) {
    d.run("UPDATE tasks SET priority_reason = ?, updated_at = ? WHERE id = ?", [input.priority_reason, now(), taskId]);
  }
}

export function exportTaskFields(taskId: string, db?: Database): Record<string, unknown> {
  const d = getDatabase(db);
  const task = d.query("SELECT priority, priority_score, priority_reason FROM tasks WHERE id = ?").get(taskId) as {
    priority: string;
    priority_score: number | null;
    priority_reason: string | null;
  } | null;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  return {
    priority: task.priority,
    priority_score: task.priority_score,
    priority_reason: task.priority_reason,
    labels: getTaskLabels(taskId, d).map((l) => ({ name: l.name, color: l.color })),
    custom_fields: getTaskCustomFields(taskId, d),
  };
}
