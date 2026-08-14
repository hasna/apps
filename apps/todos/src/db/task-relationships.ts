import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

// Relationship types between tasks
export const RELATIONSHIP_TYPES = [
  "related_to",
  "conflicts_with",
  "similar_to",
  "duplicates",
  "supersedes",
  "modifies_same_file",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface TaskRelationship {
  id: string;
  source_task_id: string;
  target_task_id: string;
  relationship_type: RelationshipType;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

interface TaskRelationshipRow {
  id: string;
  source_task_id: string;
  target_task_id: string;
  relationship_type: string;
  metadata: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AddTaskRelationshipInput {
  source_task_id: string;
  target_task_id: string;
  relationship_type: RelationshipType;
  metadata?: Record<string, unknown>;
  created_by?: string;
}

function rowToRelationship(row: TaskRelationshipRow): TaskRelationship {
  return {
    ...row,
    relationship_type: row.relationship_type as RelationshipType,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function addTaskRelationship(input: AddTaskRelationshipInput, db?: Database): TaskRelationship {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  if (input.source_task_id === input.target_task_id) {
    throw new Error("Cannot create a relationship between a task and itself");
  }

  // Check for existing relationship (either direction for symmetric types)
  const symmetric: RelationshipType[] = ["related_to", "conflicts_with", "similar_to", "modifies_same_file"];
  if (symmetric.includes(input.relationship_type)) {
    const existing = d.query(
      `SELECT id FROM task_relationships
       WHERE relationship_type = ?
         AND ((source_task_id = ? AND target_task_id = ?) OR (source_task_id = ? AND target_task_id = ?))`,
    ).get(input.relationship_type, input.source_task_id, input.target_task_id, input.target_task_id, input.source_task_id) as { id: string } | null;
    if (existing) {
      return getTaskRelationship(existing.id, d)!;
    }
  } else {
    // Directional: only check exact direction
    const existing = d.query(
      "SELECT id FROM task_relationships WHERE source_task_id = ? AND target_task_id = ? AND relationship_type = ?",
    ).get(input.source_task_id, input.target_task_id, input.relationship_type) as { id: string } | null;
    if (existing) {
      return getTaskRelationship(existing.id, d)!;
    }
  }

  d.run(
    `INSERT INTO task_relationships (id, source_task_id, target_task_id, relationship_type, metadata, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.source_task_id, input.target_task_id, input.relationship_type,
     JSON.stringify(input.metadata || {}), input.created_by || null, timestamp],
  );
  return getTaskRelationship(id, d)!;
}

export function getTaskRelationship(id: string, db?: Database): TaskRelationship | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM task_relationships WHERE id = ?").get(id) as TaskRelationshipRow | null;
  return row ? rowToRelationship(row) : null;
}

export function removeTaskRelationship(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM task_relationships WHERE id = ?", [id]).changes > 0;
}

export function removeTaskRelationshipByPair(
  sourceTaskId: string,
  targetTaskId: string,
  relationshipType: RelationshipType,
  db?: Database,
): boolean {
  const d = db || getDatabase();
  const symmetric: RelationshipType[] = ["related_to", "conflicts_with", "similar_to", "modifies_same_file"];
  if (symmetric.includes(relationshipType)) {
    return d.run(
      `DELETE FROM task_relationships
       WHERE relationship_type = ?
         AND ((source_task_id = ? AND target_task_id = ?) OR (source_task_id = ? AND target_task_id = ?))`,
      [relationshipType, sourceTaskId, targetTaskId, targetTaskId, sourceTaskId],
    ).changes > 0;
  }
  return d.run(
    "DELETE FROM task_relationships WHERE source_task_id = ? AND target_task_id = ? AND relationship_type = ?",
    [sourceTaskId, targetTaskId, relationshipType],
  ).changes > 0;
}

/**
 * Get all relationships for a task (both as source and target).
 */
export function getTaskRelationships(
  taskId: string,
  relationshipType?: RelationshipType,
  db?: Database,
): TaskRelationship[] {
  const d = db || getDatabase();
  let sql = "SELECT * FROM task_relationships WHERE (source_task_id = ? OR target_task_id = ?)";
  const params: string[] = [taskId, taskId];
  if (relationshipType) {
    sql += " AND relationship_type = ?";
    params.push(relationshipType);
  }
  sql += " ORDER BY created_at DESC";
  return (d.query(sql).all(...params) as TaskRelationshipRow[]).map(rowToRelationship);
}

/**
 * Find tasks related to a given task (returns the "other" task IDs).
 */
export function findRelatedTaskIds(
  taskId: string,
  relationshipType?: RelationshipType,
  db?: Database,
): string[] {
  const rels = getTaskRelationships(taskId, relationshipType, db);
  const ids = new Set<string>();
  for (const rel of rels) {
    if (rel.source_task_id === taskId) ids.add(rel.target_task_id);
    else ids.add(rel.source_task_id);
  }
  return [...ids];
}

/**
 * Auto-detect tasks that modify the same file and create modifies_same_file relationships.
 */
export function autoDetectFileRelationships(taskId: string, db?: Database): TaskRelationship[] {
  const d = db || getDatabase();
  // Find files associated with this task
  const files = d.query(
    "SELECT path FROM task_files WHERE task_id = ? AND status != 'removed'",
  ).all(taskId) as { path: string }[];

  const created: TaskRelationship[] = [];
  for (const file of files) {
    // Find other tasks that reference the same file
    const others = d.query(
      "SELECT DISTINCT task_id FROM task_files WHERE path = ? AND task_id != ? AND status != 'removed'",
    ).all(file.path, taskId) as { task_id: string }[];

    for (const other of others) {
      try {
        const rel = addTaskRelationship({
          source_task_id: taskId,
          target_task_id: other.task_id,
          relationship_type: "modifies_same_file",
          metadata: { shared_file: file.path },
        }, d);
        created.push(rel);
      } catch {
        // Already exists or self-reference, skip
      }
    }
  }
  return created;
}
