import crypto from "crypto";
import { getDb } from "./database.js";
import type { Project } from "../types/index.js";
import { sanitizeLocationForOutput, sanitizeTextForBoundary } from "../lib/finding-safety.js";

function rowToProject(row: Project): Project {
  const safe = {
    ...row,
    name: sanitizeTextForBoundary(row.name, 256),
    path: sanitizeLocationForOutput(row.path),
  };
  if (safe.name !== row.name || safe.path !== row.path) {
    try {
      getDb().prepare("UPDATE projects SET name = ?, path = ?, updated_at = ? WHERE id = ?").run(
        safe.name,
        safe.path,
        new Date().toISOString(),
        row.id,
      );
    } catch {
      // Read results remain sanitized when a legacy database is read-only.
    }
  }
  return safe;
}

export function createProject(name: string, path: string): Project {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const safeName = sanitizeTextForBoundary(name, 256);
  const safePath = sanitizeLocationForOutput(path);

  const stmt = db.prepare(
    `INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run(id, safeName, safePath, now, now);

  return { id, name: safeName, path: safePath, created_at: now, updated_at: now };
}

export function getProject(id: string): Project | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM projects WHERE id = ?`);
  const row = stmt.get(id) as Project | undefined;
  return row ? rowToProject(row) : null;
}

export function getProjectByPath(path: string): Project | null {
  const db = getDb();
  const safePath = sanitizeLocationForOutput(path);
  const stmt = db.prepare(`SELECT * FROM projects WHERE path = ? OR path = ? LIMIT 1`);
  const row = stmt.get(safePath, path) as Project | undefined;
  return row ? rowToProject(row) : null;
}

export function listProjects(): Project[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`);
  return (stmt.all() as Project[]).map(rowToProject);
}

export function deleteProject(id: string): void {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM projects WHERE id = ?`);
  stmt.run(id);
}
