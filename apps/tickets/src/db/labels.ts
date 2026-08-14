import type { Database } from "bun:sqlite";
import { getDatabase, uuid } from "./database.ts";
import type { Label } from "../types/index.ts";
import { NotFoundError, ValidationError } from "../types/index.ts";

interface RawLabel { id: string; project_id: string; name: string; color: string; description: string | null }

function rowToLabel(r: RawLabel): Label {
  return { id: r.id, project_id: r.project_id, name: r.name, color: r.color, description: r.description };
}

export function createLabel(projectId: string, name: string, color = "#6b7280", description?: string, db?: Database): Label {
  const database = db ?? getDatabase();
  if (!name.trim()) throw new ValidationError("Label name is required");
  const id = uuid();
  try {
    database.run(
      "INSERT INTO labels (id, project_id, name, color, description) VALUES (?, ?, ?, ?, ?)",
      [id, projectId, name.trim(), color, description ?? null]
    );
  } catch { throw new ValidationError(`Label "${name}" already exists in this project`); }
  return { id, project_id: projectId, name: name.trim(), color, description: description ?? null };
}

export function listLabels(projectId: string, db?: Database): Label[] {
  const database = db ?? getDatabase();
  return database.query<RawLabel, [string]>(
    "SELECT * FROM labels WHERE project_id = ? ORDER BY name ASC"
  ).all(projectId).map(rowToLabel);
}

export function updateLabel(id: string, updates: { name?: string; color?: string; description?: string }, db?: Database): Label {
  const database = db ?? getDatabase();
  const row = database.query<RawLabel, [string]>("SELECT * FROM labels WHERE id = ?").get(id);
  if (!row) throw new NotFoundError("Label", id);
  const name = updates.name ?? row.name;
  const color = updates.color ?? row.color;
  const description = updates.description !== undefined ? updates.description : row.description;
  database.run("UPDATE labels SET name = ?, color = ?, description = ? WHERE id = ?", [name, color, description, id]);
  return { id, project_id: row.project_id, name, color, description };
}

export function deleteLabel(id: string, db?: Database): void {
  const database = db ?? getDatabase();
  const result = database.run("DELETE FROM labels WHERE id = ?", [id]);
  if (result.changes === 0) throw new NotFoundError("Label", id);
}
