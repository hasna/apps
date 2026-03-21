import crypto from "crypto";
import { getDb } from "./database.js";
import type { Project } from "../types/index.js";

export function createProject(name: string, path: string): Project {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run(id, name, path, now, now);

  return { id, name, path, created_at: now, updated_at: now };
}

export function getProject(id: string): Project | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM projects WHERE id = ?`);
  const row = stmt.get(id) as Project | undefined;
  return row ?? null;
}

export function getProjectByPath(path: string): Project | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM projects WHERE path = ?`);
  const row = stmt.get(path) as Project | undefined;
  return row ?? null;
}

export function listProjects(): Project[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`);
  return stmt.all() as Project[];
}

export function deleteProject(id: string): void {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM projects WHERE id = ?`);
  stmt.run(id);
}
