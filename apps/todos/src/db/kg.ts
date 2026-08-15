import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export interface KgEdge {
  id: string;
  source_id: string;
  source_type: string;
  target_id: string;
  target_type: string;
  relation_type: string;
  weight: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface KgEdgeRow {
  id: string;
  source_id: string;
  source_type: string;
  target_id: string;
  target_type: string;
  relation_type: string;
  weight: number;
  metadata: string | null;
  created_at: string;
}

function rowToEdge(row: KgEdgeRow): KgEdge {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

/**
 * Sync all existing relationships into kg_edges.
 * Idempotent — uses INSERT OR IGNORE with composite unique constraint.
 */
export function syncKgEdges(db?: Database): { synced: number } {
  const d = db || getDatabase();
  let synced = 0;

  const tx = d.transaction(() => {
    // 1. Task dependencies → depends_on
    const deps = d.query(
      "SELECT task_id, depends_on FROM task_dependencies",
    ).all() as { task_id: string; depends_on: string }[];
    for (const dep of deps) {
      synced += upsertEdge(d, dep.task_id, "task", dep.depends_on, "task", "depends_on");
    }

    // 2. Task assignments → assigned_to
    const assignments = d.query(
      "SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL",
    ).all() as { id: string; assigned_to: string }[];
    for (const a of assignments) {
      synced += upsertEdge(d, a.id, "task", a.assigned_to, "agent", "assigned_to");
    }

    // 3. Agent hierarchy → reports_to
    const agents = d.query(
      "SELECT id, reports_to FROM agents WHERE reports_to IS NOT NULL",
    ).all() as { id: string; reports_to: string }[];
    for (const a of agents) {
      synced += upsertEdge(d, a.id, "agent", a.reports_to, "agent", "reports_to");
    }

    // 4. Task files → references_file
    const files = d.query(
      "SELECT task_id, path FROM task_files WHERE status != 'removed'",
    ).all() as { task_id: string; path: string }[];
    for (const f of files) {
      synced += upsertEdge(d, f.task_id, "task", f.path, "file", "references_file");
    }

    // 5. Task → project
    const taskProjects = d.query(
      "SELECT id, project_id FROM tasks WHERE project_id IS NOT NULL",
    ).all() as { id: string; project_id: string }[];
    for (const tp of taskProjects) {
      synced += upsertEdge(d, tp.id, "task", tp.project_id, "project", "in_project");
    }

    // 6. Task → plan
    const taskPlans = d.query(
      "SELECT id, plan_id FROM tasks WHERE plan_id IS NOT NULL",
    ).all() as { id: string; plan_id: string }[];
    for (const tp of taskPlans) {
      synced += upsertEdge(d, tp.id, "task", tp.plan_id, "plan", "in_plan");
    }

    // 7. Task relationships → semantic
    try {
      const rels = d.query(
        "SELECT source_task_id, target_task_id, relationship_type FROM task_relationships",
      ).all() as { source_task_id: string; target_task_id: string; relationship_type: string }[];
      for (const r of rels) {
        synced += upsertEdge(d, r.source_task_id, "task", r.target_task_id, "task", r.relationship_type);
      }
    } catch {
      // task_relationships may not exist yet
    }
  });

  tx();
  return { synced };
}

function upsertEdge(
  d: Database,
  sourceId: string, sourceType: string,
  targetId: string, targetType: string,
  relationType: string,
  weight = 1.0,
): number {
  try {
    d.run(
      `INSERT OR IGNORE INTO kg_edges (id, source_id, source_type, target_id, target_type, relation_type, weight, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
      [uuid(), sourceId, sourceType, targetId, targetType, relationType, weight, now()],
    );
    return 1;
  } catch {
    return 0;
  }
}

/**
 * Get all entities related to a given entity.
 */
export function getRelated(
  entityId: string,
  opts?: { relation_type?: string; entity_type?: string; direction?: "outgoing" | "incoming" | "both"; limit?: number },
  db?: Database,
): KgEdge[] {
  const d = db || getDatabase();
  const direction = opts?.direction || "both";
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (direction === "outgoing" || direction === "both") {
    conditions.push("source_id = ?");
    params.push(entityId);
  }
  if (direction === "incoming" || direction === "both") {
    conditions.push("target_id = ?");
    params.push(entityId);
  }

  let sql = `SELECT * FROM kg_edges WHERE (${conditions.join(" OR ")})`;

  if (opts?.relation_type) {
    sql += " AND relation_type = ?";
    params.push(opts.relation_type);
  }
  if (opts?.entity_type) {
    sql += " AND (source_type = ? OR target_type = ?)";
    params.push(opts.entity_type, opts.entity_type);
  }
  sql += " ORDER BY weight DESC, created_at DESC";
  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }

  return (d.query(sql).all(...params) as KgEdgeRow[]).map(rowToEdge);
}

/**
 * Find path between two entities using recursive CTE (BFS).
 * Returns the edges forming the shortest path, or empty if no path exists.
 */
export function findPath(
  sourceId: string,
  targetId: string,
  opts?: { max_depth?: number; relation_types?: string[] },
  db?: Database,
): KgEdge[][] {
  const d = db || getDatabase();
  const maxDepth = opts?.max_depth || 5;

  // BFS in application code for flexibility
  const visited = new Set<string>();
  const queue: { id: string; path: KgEdge[] }[] = [{ id: sourceId, path: [] }];
  const results: KgEdge[][] = [];

  visited.add(sourceId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length >= maxDepth) continue;

    let sql = "SELECT * FROM kg_edges WHERE source_id = ?";
    const params: string[] = [current.id];

    if (opts?.relation_types && opts.relation_types.length > 0) {
      const placeholders = opts.relation_types.map(() => "?").join(",");
      sql += ` AND relation_type IN (${placeholders})`;
      params.push(...opts.relation_types);
    }

    const edges = (d.query(sql).all(...params) as KgEdgeRow[]).map(rowToEdge);

    for (const edge of edges) {
      const nextId = edge.target_id;
      const newPath = [...current.path, edge];

      if (nextId === targetId) {
        results.push(newPath);
        if (results.length >= 3) return results; // Return up to 3 paths
        continue;
      }

      if (!visited.has(nextId)) {
        visited.add(nextId);
        queue.push({ id: nextId, path: newPath });
      }
    }
  }

  return results;
}

/**
 * Get impact analysis: what entities are affected if a given entity changes.
 * Traverses outgoing edges recursively.
 */
export function getImpactAnalysis(
  entityId: string,
  opts?: { max_depth?: number; relation_types?: string[] },
  db?: Database,
): { entity_id: string; entity_type: string; depth: number; relation: string }[] {
  const d = db || getDatabase();
  const maxDepth = opts?.max_depth || 3;
  const results: { entity_id: string; entity_type: string; depth: number; relation: string }[] = [];
  const visited = new Set<string>();
  visited.add(entityId);

  const queue: { id: string; depth: number }[] = [{ id: entityId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    let sql = "SELECT * FROM kg_edges WHERE source_id = ?";
    const params: string[] = [current.id];

    if (opts?.relation_types && opts.relation_types.length > 0) {
      const placeholders = opts.relation_types.map(() => "?").join(",");
      sql += ` AND relation_type IN (${placeholders})`;
      params.push(...opts.relation_types);
    }

    const edges = (d.query(sql).all(...params) as KgEdgeRow[]).map(rowToEdge);

    for (const edge of edges) {
      if (!visited.has(edge.target_id)) {
        visited.add(edge.target_id);
        results.push({
          entity_id: edge.target_id,
          entity_type: edge.target_type,
          depth: current.depth + 1,
          relation: edge.relation_type,
        });
        queue.push({ id: edge.target_id, depth: current.depth + 1 });
      }
    }
  }

  return results;
}

/**
 * Get critical path: tasks that block the most downstream work.
 * Returns tasks sorted by how many other tasks they transitively block.
 */
export function getCriticalPath(
  opts?: { project_id?: string; limit?: number },
  db?: Database,
): { task_id: string; blocking_count: number; depth: number }[] {
  const d = db || getDatabase();

  // Get all dependency edges
  let sql = `SELECT source_id, target_id FROM kg_edges WHERE relation_type = 'depends_on'`;
  const params: string[] = [];
  if (opts?.project_id) {
    sql += ` AND source_id IN (SELECT id FROM tasks WHERE project_id = ?)`;
    params.push(opts.project_id);
  }

  const edges = d.query(sql).all(...params) as { source_id: string; target_id: string }[];

  // Build adjacency list: depends_on → blocks
  const blocks = new Map<string, Set<string>>();
  for (const e of edges) {
    // e.source_id depends_on e.target_id → e.target_id blocks e.source_id
    if (!blocks.has(e.target_id)) blocks.set(e.target_id, new Set());
    blocks.get(e.target_id)!.add(e.source_id);
  }

  // For each node, compute transitive downstream count
  const results: { task_id: string; blocking_count: number; depth: number }[] = [];

  for (const [taskId] of blocks) {
    const visited = new Set<string>();
    const q = [taskId];
    let maxDepth = 0;
    let depth = 0;
    let levelSize = q.length;

    while (q.length > 0) {
      const node = q.shift()!;
      levelSize--;

      const downstream = blocks.get(node);
      if (downstream) {
        for (const d of downstream) {
          if (!visited.has(d)) {
            visited.add(d);
            q.push(d);
          }
        }
      }

      if (levelSize === 0) {
        depth++;
        maxDepth = Math.max(maxDepth, depth);
        levelSize = q.length;
      }
    }

    if (visited.size > 0) {
      results.push({ task_id: taskId, blocking_count: visited.size, depth: maxDepth });
    }
  }

  results.sort((a, b) => b.blocking_count - a.blocking_count);
  return results.slice(0, opts?.limit || 20);
}

/**
 * Add a single edge to the knowledge graph.
 */
export function addKgEdge(
  sourceId: string, sourceType: string,
  targetId: string, targetType: string,
  relationType: string,
  weight = 1.0,
  metadata?: Record<string, unknown>,
  db?: Database,
): KgEdge {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT OR IGNORE INTO kg_edges (id, source_id, source_type, target_id, target_type, relation_type, weight, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, sourceId, sourceType, targetId, targetType, relationType, weight, JSON.stringify(metadata || {}), timestamp],
  );
  return { id, source_id: sourceId, source_type: sourceType, target_id: targetId, target_type: targetType, relation_type: relationType, weight, metadata: metadata || {}, created_at: timestamp };
}

/**
 * Remove edges matching criteria.
 */
export function removeKgEdges(
  sourceId: string,
  targetId: string,
  relationType?: string,
  db?: Database,
): number {
  const d = db || getDatabase();
  if (relationType) {
    return d.run(
      "DELETE FROM kg_edges WHERE source_id = ? AND target_id = ? AND relation_type = ?",
      [sourceId, targetId, relationType],
    ).changes;
  }
  return d.run(
    "DELETE FROM kg_edges WHERE source_id = ? AND target_id = ?",
    [sourceId, targetId],
  ).changes;
}
