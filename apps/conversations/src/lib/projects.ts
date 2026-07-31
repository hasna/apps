import { getDb } from "./db.js";
import { randomUUID } from "crypto";
import type { Project, ProjectInfo } from "../types.js";
import { PROJECT_LIST_ORDER, simpleOrderByClause } from "./list-order.js";

/**
 * Coerce a raw project DB/API row into the client-facing {@link Project} shape:
 * `tags`/`metadata`/`settings` parsed from their JSON-text columns, nullable
 * fields normalized. Pure (no sqlite); shared by the local lib and the ApiStore so
 * both transports return the identical contract — `tags` is ALWAYS an array, never
 * a raw JSON string or null (that mismatch crashed `project get` in cloud mode).
 */
export function parseProject(row: Record<string, unknown>): Project {
  // Columns are JSON text (sqlite + the Postgres TEXT columns), but tolerate an
  // already-parsed value in case a transport hands back native JSON.
  const asObject = (v: unknown): Record<string, unknown> | null => {
    if (v == null) return null;
    if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    if (typeof v !== "string") return null;
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  const metadata = asObject(row.metadata);

  let tags: string[] = [];
  if (Array.isArray(row.tags)) {
    tags = row.tags as string[];
  } else if (typeof row.tags === "string" && row.tags) {
    try {
      const p = JSON.parse(row.tags);
      tags = Array.isArray(p) ? p : [];
    } catch {
      tags = [];
    }
  }

  const settings = asObject(row.settings);

  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || null,
    path: (row.path as string) || null,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    metadata,
    tags,
    status: (row.status as "active" | "archived") || "active",
    repository: (row.repository as string) || null,
    settings,
  };
}

export function createProject(opts: {
  name: string;
  created_by: string;
  description?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  repository?: string;
  settings?: Record<string, unknown>;
}): Project {
  const db = getDb();
  const id = randomUUID();
  const metadata = opts.metadata ? JSON.stringify(opts.metadata) : null;
  const tags = opts.tags ? JSON.stringify(opts.tags) : null;
  const settings = opts.settings ? JSON.stringify(opts.settings) : null;

  const row = db.prepare(`
    INSERT INTO projects (id, name, description, path, created_by, metadata, tags, repository, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    id,
    opts.name,
    opts.description || null,
    opts.path || null,
    opts.created_by,
    metadata,
    tags,
    opts.repository || null,
    settings,
  ) as Record<string, unknown>;

  return parseProject(row);
}

export function listProjects(opts?: {
  status?: "active" | "archived";
  limit?: number;
  offset?: number;
}): ProjectInfo[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (opts?.status) {
    conditions.push("p.status = ?");
    params.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  let pagination = "";
  if (typeof opts?.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0) {
    pagination += " LIMIT ?";
    params.push(Math.floor(opts.limit));
  }
  if (typeof opts?.offset === "number" && Number.isFinite(opts.offset) && opts.offset >= 0) {
    if (!pagination.includes("LIMIT")) {
      pagination += " LIMIT -1";
    }
    pagination += " OFFSET ?";
    params.push(Math.floor(opts.offset));
  }

  const rows = db.prepare(`
    SELECT
      p.*,
      (SELECT COUNT(*) FROM channels WHERE project_id = p.id) AS channel_count
    FROM projects p
    ${where}
    ${simpleOrderByClause(PROJECT_LIST_ORDER, "p.")}
    ${pagination}
  `).all(...params) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...parseProject(row),
    channel_count: row.channel_count as number,
  }));
}

export function getProject(id: string): ProjectInfo | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      p.*,
      (SELECT COUNT(*) FROM channels WHERE project_id = p.id) AS channel_count
    FROM projects p
    WHERE p.id = ?
  `).get(id) as Record<string, unknown> | null;

  if (!row) return null;

  return {
    ...parseProject(row),
    channel_count: row.channel_count as number,
  };
}

export function getProjectByName(name: string): ProjectInfo | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      p.*,
      (SELECT COUNT(*) FROM channels WHERE project_id = p.id) AS channel_count
    FROM projects p
    WHERE p.name = ?
  `).get(name) as Record<string, unknown> | null;

  if (!row) return null;

  return {
    ...parseProject(row),
    channel_count: row.channel_count as number,
  };
}

export function updateProject(id: string, updates: {
  name?: string;
  description?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  status?: "active" | "archived";
  repository?: string;
  settings?: Record<string, unknown>;
}): Project {
  const db = getDb();

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) { sets.push("name = ?"); params.push(updates.name); }
  if (updates.description !== undefined) { sets.push("description = ?"); params.push(updates.description); }
  if (updates.path !== undefined) { sets.push("path = ?"); params.push(updates.path); }
  if (updates.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(updates.metadata)); }
  if (updates.tags !== undefined) { sets.push("tags = ?"); params.push(JSON.stringify(updates.tags)); }
  if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
  if (updates.repository !== undefined) { sets.push("repository = ?"); params.push(updates.repository); }
  if (updates.settings !== undefined) { sets.push("settings = ?"); params.push(JSON.stringify(updates.settings)); }

  // If nothing to update, fetch and return current state
  if (sets.length === 0) {
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) throw new Error(`Project not found: ${id}`);
    return parseProject(row);
  }

  params.push(id);
  const row = db.prepare(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = ? RETURNING *`
  ).get(...params) as Record<string, unknown> | null;

  if (!row) throw new Error(`Project not found: ${id}`);
  return parseProject(row);
}

export function deleteProject(id: string): boolean {
  const db = getDb();

  // Check if any channels reference this project
  const channelCount = (db.prepare(
    "SELECT COUNT(*) as c FROM channels WHERE project_id = ?"
  ).get(id) as { c: number }).c;

  if (channelCount > 0) {
    throw new Error(`Cannot delete project: ${channelCount} channel(s) still reference it`);
  }

  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}
