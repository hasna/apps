import {
  type Project,
  type ProjectRow,
  projectFromRow,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

export function createProject(input: {
  name: string;
  path?: string;
  description?: string;
}): Project {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO projects (id, name, path, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.path ?? null,
    input.description ?? null,
    timestamp,
    timestamp,
  );

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
