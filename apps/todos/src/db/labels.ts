import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface Label {
  id: string;
  project_id: string | null;
  name: string;
  color: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface LabelRow {
  id: string;
  project_id: string | null;
  name: string;
  color: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLabel(row: LabelRow): Label {
  return { ...row };
}

export interface CreateLabelInput {
  name: string;
  project_id?: string;
  color?: string;
  description?: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
  description?: string;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function createLabel(input: CreateLabelInput, db?: Database): Label {
  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  d.run(
    `INSERT INTO labels (id, project_id, name, color, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.project_id ?? null, input.name.trim(), input.color ?? null, input.description ?? null, ts, ts],
  );
  return rowToLabel(d.query("SELECT * FROM labels WHERE id = ?").get(id) as LabelRow);
}

export function getLabel(idOrName: string, db?: Database): Label | null {
  const d = db || getDatabase();
  let row = d.query("SELECT * FROM labels WHERE id = ?").get(idOrName) as LabelRow | null;
  if (!row) {
    row = d.query("SELECT * FROM labels WHERE lower(name) = ?").get(normalizeName(idOrName)) as LabelRow | null;
  }
  return row ? rowToLabel(row) : null;
}

export function listLabels(projectId?: string, db?: Database): Label[] {
  const d = db || getDatabase();
  if (projectId) {
    return (d.query("SELECT * FROM labels WHERE project_id IS NULL OR project_id = ? ORDER BY name").all(projectId) as LabelRow[]).map(rowToLabel);
  }
  return (d.query("SELECT * FROM labels ORDER BY name").all() as LabelRow[]).map(rowToLabel);
}

export function updateLabel(idOrName: string, input: UpdateLabelInput, db?: Database): Label {
  const d = db || getDatabase();
  const existing = getLabel(idOrName, d);
  if (!existing) throw new Error(`Label not found: ${idOrName}`);

  const ts = now();
  d.run(
    `UPDATE labels SET
      name = COALESCE(?, name),
      color = COALESCE(?, color),
      description = COALESCE(?, description),
      updated_at = ?
     WHERE id = ?`,
    [input.name?.trim() ?? null, input.color ?? null, input.description ?? null, ts, existing.id],
  );
  return getLabel(existing.id, d)!;
}

export function deleteLabel(idOrName: string, db?: Database): boolean {
  const d = db || getDatabase();
  const existing = getLabel(idOrName, d);
  if (!existing) return false;
  d.run("DELETE FROM task_labels WHERE label_id = ?", [existing.id]);
  return d.run("DELETE FROM labels WHERE id = ?", [existing.id]).changes > 0;
}

export function assignLabelToTask(taskId: string, labelIdOrName: string, db?: Database): Label {
  const d = db || getDatabase();
  const label = getLabel(labelIdOrName, d);
  if (!label) throw new Error(`Label not found: ${labelIdOrName}`);

  d.run("INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)", [taskId, label.id]);
  d.run("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)", [taskId, label.name]);
  return label;
}

export function removeLabelFromTask(taskId: string, labelIdOrName: string, db?: Database): boolean {
  const d = db || getDatabase();
  const label = getLabel(labelIdOrName, d);
  if (!label) return false;
  d.run("DELETE FROM task_labels WHERE task_id = ? AND label_id = ?", [taskId, label.id]);
  d.run("DELETE FROM task_tags WHERE task_id = ? AND tag = ?", [taskId, label.name]);
  return true;
}

export function getTaskLabels(taskId: string, db?: Database): Label[] {
  const d = db || getDatabase();
  const rows = d.query(
    `SELECT l.* FROM labels l
     JOIN task_labels tl ON tl.label_id = l.id
     WHERE tl.task_id = ?
     ORDER BY l.name`,
  ).all(taskId) as LabelRow[];
  return rows.map(rowToLabel);
}
