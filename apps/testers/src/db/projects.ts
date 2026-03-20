import {
  type Project,
  type ProjectRow,
  type CreateProjectInput,
  type UpdateProjectInput,
  projectFromRow,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function createProject(input: CreateProjectInput): Project {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO projects (id, name, path, description, base_url, port, settings, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.path ?? null,
    input.description ?? null,
    input.baseUrl ?? null,
    input.port ?? null,
    input.settings ? JSON.stringify(input.settings) : "{}",
    timestamp,
    timestamp,
  );

  return getProject(id)!;
}

export function updateProject(id: string, input: UpdateProjectInput): Project {
  const db = getDatabase();
  const existing = getProject(id);
  if (!existing) throw new Error(`Project not found: ${id}`);

  const timestamp = now();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
  if (input.baseUrl !== undefined) { fields.push("base_url = ?"); values.push(input.baseUrl); }
  if (input.port !== undefined) { fields.push("port = ?"); values.push(input.port); }
  if (input.settings !== undefined) { fields.push("settings = ?"); values.push(JSON.stringify(input.settings)); }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  values.push(timestamp);
  values.push(id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db.query(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`) as any).run(...values);

  return getProject(id)!;
}

export function getProject(id: string): Project | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | null;
  return row ? projectFromRow(row) : null;
}

export function getProjectByPath(path: string): Project | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM projects WHERE path = ?").get(path) as ProjectRow | null;
  return row ? projectFromRow(row) : null;
}

export function listProjects(): Project[] {
  const db = getDatabase();
  const rows = db.query("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[];
  return rows.map(projectFromRow);
}

export function ensureProject(name: string, path: string): Project {
  const db = getDatabase();

  // Try by path first
  const byPath = db.query("SELECT * FROM projects WHERE path = ?").get(path) as ProjectRow | null;
  if (byPath) return projectFromRow(byPath);

  // Try by name
  const byName = db.query("SELECT * FROM projects WHERE name = ?").get(name) as ProjectRow | null;
  if (byName) return projectFromRow(byName);

  // Create new
  return createProject({ name, path });
}
