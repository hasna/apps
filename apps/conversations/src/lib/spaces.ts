import { getDb } from "./db.js";
import type { Space, SpaceInfo, SpaceMember } from "../types.js";

/**
 * Get the depth of a space in the hierarchy.
 * Top-level = 0, child of top-level = 1, grandchild = 2.
 */
export function getSpaceDepth(spaceName: string): number {
  const db = getDb();
  let depth = 0;
  let current = spaceName;

  for (let i = 0; i < 10; i++) { // safety limit
    const row = db.prepare("SELECT parent_id FROM spaces WHERE name = ?").get(current) as { parent_id: string | null } | null;
    if (!row || !row.parent_id) break;
    depth++;
    current = row.parent_id;
  }

  return depth;
}

export function createSpace(
  name: string,
  createdBy: string,
  options?: { description?: string; parent_id?: string; project_id?: string },
): Space {
  const db = getDb();

  // Enforce max 3 levels deep (0, 1, 2)
  if (options?.parent_id) {
    const parentExists = db.prepare("SELECT name FROM spaces WHERE name = ?").get(options.parent_id);
    if (!parentExists) {
      throw new Error(`Parent space not found: ${options.parent_id}`);
    }
    const parentDepth = getSpaceDepth(options.parent_id);
    if (parentDepth >= 2) {
      throw new Error("Maximum space nesting depth is 3 levels");
    }
  }

  // Validate project_id if provided
  if (options?.project_id) {
    const projectExists = db.prepare("SELECT id FROM projects WHERE id = ?").get(options.project_id);
    if (!projectExists) {
      throw new Error(`Project not found: ${options.project_id}`);
    }
  }

  const row = db.prepare(
    "INSERT INTO spaces (name, description, parent_id, project_id, created_by) VALUES (?, ?, ?, ?, ?) RETURNING *"
  ).get(
    name,
    options?.description || null,
    options?.parent_id || null,
    options?.project_id || null,
    createdBy,
  ) as Space;

  // Auto-join creator
  db.prepare(
    "INSERT OR IGNORE INTO space_members (space, agent) VALUES (?, ?)"
  ).run(name, createdBy);

  return row;
}

export function listSpaces(options?: {
  project_id?: string;
  parent_id?: string | null;
  flat?: boolean;
  include_archived?: boolean;
}): SpaceInfo[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | null)[] = [];

  if (options?.project_id) {
    conditions.push("s.project_id = ?");
    params.push(options.project_id);
  }

  if (options?.parent_id !== undefined) {
    if (options.parent_id === null) {
      conditions.push("s.parent_id IS NULL");
    } else {
      conditions.push("s.parent_id = ?");
      params.push(options.parent_id);
    }
  }

  // Exclude archived spaces by default
  if (!options?.include_archived) {
    conditions.push("s.archived_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT
      s.name,
      s.description,
      s.parent_id,
      s.project_id,
      s.created_by,
      s.created_at,
      s.archived_at,
      (SELECT COUNT(*) FROM space_members WHERE space = s.name) AS member_count,
      (SELECT COUNT(*) FROM messages WHERE space = s.name) AS message_count
    FROM spaces s
    ${where}
    ORDER BY s.name ASC
  `).all(...params) as SpaceInfo[];

  return rows;
}

export function getSpace(name: string): SpaceInfo | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      s.name,
      s.description,
      s.parent_id,
      s.project_id,
      s.created_by,
      s.created_at,
      s.archived_at,
      (SELECT COUNT(*) FROM space_members WHERE space = s.name) AS member_count,
      (SELECT COUNT(*) FROM messages WHERE space = s.name) AS message_count
    FROM spaces s
    WHERE s.name = ?
  `).get(name) as SpaceInfo | null;
  return row;
}

export function joinSpace(spaceName: string, agent: string): boolean {
  const db = getDb();
  const space = db.prepare("SELECT name FROM spaces WHERE name = ?").get(spaceName);
  if (!space) return false;

  db.prepare(
    "INSERT OR IGNORE INTO space_members (space, agent) VALUES (?, ?)"
  ).run(spaceName, agent);
  return true;
}

export function leaveSpace(spaceName: string, agent: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM space_members WHERE space = ? AND agent = ?"
  ).run(spaceName, agent);
  return result.changes > 0;
}

export function getSpaceMembers(spaceName: string): SpaceMember[] {
  const db = getDb();
  return db.prepare(
    "SELECT space, agent, joined_at FROM space_members WHERE space = ? ORDER BY joined_at ASC"
  ).all(spaceName) as SpaceMember[];
}

export function updateSpace(name: string, updates: {
  description?: string;
  parent_id?: string | null;
  project_id?: string | null;
}): Space {
  const db = getDb();

  const existing = db.prepare("SELECT * FROM spaces WHERE name = ?").get(name) as Space | null;
  if (!existing) {
    throw new Error(`Space not found: ${name}`);
  }

  // Validate new parent_id if it changed
  if (updates.parent_id !== undefined && updates.parent_id !== existing.parent_id) {
    if (updates.parent_id !== null) {
      const parentExists = db.prepare("SELECT name FROM spaces WHERE name = ?").get(updates.parent_id);
      if (!parentExists) {
        throw new Error(`Parent space not found: ${updates.parent_id}`);
      }
      // Check depth: the new parent's depth + 1 must be <= 2 (max 3 levels: 0, 1, 2)
      const parentDepth = getSpaceDepth(updates.parent_id);
      if (parentDepth >= 2) {
        throw new Error("Maximum space nesting depth is 3 levels");
      }
      // Prevent circular references: the new parent cannot be the space itself or a descendant
      if (updates.parent_id === name) {
        throw new Error("A space cannot be its own parent");
      }
    }
  }

  // Validate new project_id if it changed
  if (updates.project_id !== undefined && updates.project_id !== existing.project_id) {
    if (updates.project_id !== null) {
      const projectExists = db.prepare("SELECT id FROM projects WHERE id = ?").get(updates.project_id);
      if (!projectExists) {
        throw new Error(`Project not found: ${updates.project_id}`);
      }
    }
  }

  const sets: string[] = [];
  const params: (string | null)[] = [];

  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description);
  }
  if (updates.parent_id !== undefined) {
    sets.push("parent_id = ?");
    params.push(updates.parent_id);
  }
  if (updates.project_id !== undefined) {
    sets.push("project_id = ?");
    params.push(updates.project_id);
  }

  if (sets.length === 0) {
    return existing;
  }

  params.push(name);
  const row = db.prepare(
    `UPDATE spaces SET ${sets.join(", ")} WHERE name = ? RETURNING *`
  ).get(...params) as Space;

  return row;
}

export function archiveSpace(name: string): Space {
  const db = getDb();

  const existing = db.prepare("SELECT * FROM spaces WHERE name = ?").get(name) as Space | null;
  if (!existing) {
    throw new Error(`Space not found: ${name}`);
  }

  const row = db.prepare(
    "UPDATE spaces SET archived_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE name = ? RETURNING *"
  ).get(name) as Space;

  return row;
}

export function unarchiveSpace(name: string): Space {
  const db = getDb();

  const existing = db.prepare("SELECT * FROM spaces WHERE name = ?").get(name) as Space | null;
  if (!existing) {
    throw new Error(`Space not found: ${name}`);
  }

  const row = db.prepare(
    "UPDATE spaces SET archived_at = NULL WHERE name = ? RETURNING *"
  ).get(name) as Space;

  return row;
}

export function isSpaceMember(spaceName: string, agent: string): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT 1 FROM space_members WHERE space = ? AND agent = ?"
  ).get(spaceName, agent);
  return !!row;
}
