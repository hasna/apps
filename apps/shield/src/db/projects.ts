import crypto from "crypto";
import { getDb } from "./database.js";
import type { Project } from "../types/index.js";
import {
  sanitizeIdentifierForOutput,
  sanitizeLocationForOutput,
  sanitizeTextForBoundary,
} from "../lib/finding-safety.js";
import {
  legacyRowContainsCredential,
  scrubLegacyCredentialRows,
} from "./legacy-credential-scrub.js";

function rowToProject(row: Project): Project {
  const safe = {
    ...row,
    id: sanitizeIdentifierForOutput(row.id, "PROJECT-ID"),
    name: sanitizeTextForBoundary(row.name, 256),
    path: sanitizeLocationForOutput(row.path),
    created_at: sanitizeTextForBoundary(row.created_at, 128),
    updated_at: sanitizeTextForBoundary(row.updated_at, 128),
  };
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
  let row = stmt.get(id) as Project | undefined;
  if (row && legacyRowContainsCredential(row as unknown as Record<string, unknown>)) {
    const result = scrubLegacyCredentialRows(db);
    row = stmt.get(result.projectIds.get(id) ?? id) as Project | undefined;
  }
  return row ? rowToProject(row) : null;
}

export function getProjectByPath(path: string): Project | null {
  const db = getDb();
  const safePath = sanitizeLocationForOutput(path);
  const stmt = db.prepare(`SELECT * FROM projects WHERE path = ? OR path = ? LIMIT 1`);
  let row = stmt.get(safePath, path) as Project | undefined;
  if (row && legacyRowContainsCredential(row as unknown as Record<string, unknown>)) {
    const result = scrubLegacyCredentialRows(db);
    row = db.prepare("SELECT * FROM projects WHERE id = ?")
      .get(result.projectIds.get(row.id) ?? row.id) as Project | undefined;
  }
  return row ? rowToProject(row) : null;
}

export function listProjects(): Project[] {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`);
  let rows = stmt.all() as Project[];
  if (rows.some((row) => legacyRowContainsCredential(row as unknown as Record<string, unknown>))) {
    const result = scrubLegacyCredentialRows(db);
    rows = rows.flatMap((row) => {
      const migrated = db.prepare("SELECT * FROM projects WHERE id = ?")
        .get(result.projectIds.get(row.id) ?? row.id) as Project | undefined;
      return migrated ? [migrated] : [];
    });
  }
  return rows.map(rowToProject);
}

export function deleteProject(id: string): void {
  const db = getDb();
  const project = getProject(id);
  const stmt = db.prepare(`DELETE FROM projects WHERE id = ?`);
  stmt.run(project?.id ?? id);
}
