import type { Database } from "bun:sqlite";
import type { ChecklistItem, ChecklistItemRow, CreateChecklistItemInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToItem(row: ChecklistItemRow): ChecklistItem {
  return { ...row, checked: !!row.checked };
}

export function getChecklist(taskId: string, db?: Database): ChecklistItem[] {
  const d = db || getDatabase();
  const rows = d
    .query("SELECT * FROM task_checklists WHERE task_id = ? ORDER BY position, created_at")
    .all(taskId) as ChecklistItemRow[];
  return rows.map(rowToItem);
}

export function addChecklistItem(input: CreateChecklistItemInput, db?: Database): ChecklistItem {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  // Determine position: append to end if not specified
  let position = input.position;
  if (position === undefined) {
    const maxRow = d
      .query("SELECT MAX(position) as max_pos FROM task_checklists WHERE task_id = ?")
      .get(input.task_id) as { max_pos: number | null } | null;
    position = (maxRow?.max_pos ?? -1) + 1;
  }

  d.run(
    "INSERT INTO task_checklists (id, task_id, position, text, checked, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
    [id, input.task_id, position, input.text, timestamp, timestamp],
  );

  return rowToItem(d.query("SELECT * FROM task_checklists WHERE id = ?").get(id) as ChecklistItemRow);
}

export function checkChecklistItem(id: string, checked: boolean, db?: Database): ChecklistItem | null {
  const d = db || getDatabase();
  const timestamp = now();
  const result = d.run(
    "UPDATE task_checklists SET checked = ?, updated_at = ? WHERE id = ?",
    [checked ? 1 : 0, timestamp, id],
  );
  if (result.changes === 0) return null;
  return rowToItem(d.query("SELECT * FROM task_checklists WHERE id = ?").get(id) as ChecklistItemRow);
}

export function updateChecklistItemText(id: string, text: string, db?: Database): ChecklistItem | null {
  const d = db || getDatabase();
  const timestamp = now();
  const result = d.run(
    "UPDATE task_checklists SET text = ?, updated_at = ? WHERE id = ?",
    [text, timestamp, id],
  );
  if (result.changes === 0) return null;
  return rowToItem(d.query("SELECT * FROM task_checklists WHERE id = ?").get(id) as ChecklistItemRow);
}

export function removeChecklistItem(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM task_checklists WHERE id = ?", [id]);
  return result.changes > 0;
}

export function clearChecklist(taskId: string, db?: Database): number {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM task_checklists WHERE task_id = ?", [taskId]);
  return result.changes;
}

export function getChecklistStats(taskId: string, db?: Database): { total: number; checked: number } {
  const d = db || getDatabase();
  const row = d
    .query("SELECT COUNT(*) as total, SUM(checked) as checked FROM task_checklists WHERE task_id = ?")
    .get(taskId) as { total: number; checked: number | null } | null;
  return { total: row?.total ?? 0, checked: row?.checked ?? 0 };
}
