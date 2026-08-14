import { getDatabase, uuid, now } from "./database.js";
import { resolvePartialId } from "./database.js";
import type { Flow, FlowRow, CreateFlowInput } from "../types/index.js";
import { flowFromRow, DependencyCycleError } from "../types/index.js";

// ─── Scenario Dependencies ──────────────────────────────────────────────────

export function addDependency(scenarioId: string, dependsOn: string): void {
  const db = getDatabase();

  // Check for cycles: if dependsOn transitively depends on scenarioId, adding
  // this edge would create a cycle. We do BFS starting from dependsOn,
  // following its own dependencies to see if we can reach scenarioId.
  const visited = new Set<string>();
  const queue: string[] = [dependsOn];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === scenarioId) {
      throw new DependencyCycleError(scenarioId, dependsOn);
    }
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = db
      .query("SELECT depends_on FROM scenario_dependencies WHERE scenario_id = ?")
      .all(current) as { depends_on: string }[];

    for (const dep of deps) {
      if (!visited.has(dep.depends_on)) {
        queue.push(dep.depends_on);
      }
    }
  }

  db.query(
    "INSERT OR IGNORE INTO scenario_dependencies (scenario_id, depends_on) VALUES (?, ?)"
  ).run(scenarioId, dependsOn);
}

export function removeDependency(scenarioId: string, dependsOn: string): boolean {
  const db = getDatabase();
  const result = db
    .query("DELETE FROM scenario_dependencies WHERE scenario_id = ? AND depends_on = ?")
    .run(scenarioId, dependsOn);
  return result.changes > 0;
}

export function getDependencies(scenarioId: string): string[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT depends_on FROM scenario_dependencies WHERE scenario_id = ?")
    .all(scenarioId) as { depends_on: string }[];
  return rows.map((r) => r.depends_on);
}

export function getDependents(scenarioId: string): string[] {
  const db = getDatabase();
  const rows = db
    .query("SELECT scenario_id FROM scenario_dependencies WHERE depends_on = ?")
    .all(scenarioId) as { scenario_id: string }[];
  return rows.map((r) => r.scenario_id);
}

export function getTransitiveDependencies(scenarioId: string): string[] {
  const db = getDatabase();
  const visited = new Set<string>();
  const queue: string[] = [scenarioId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = db
      .query("SELECT depends_on FROM scenario_dependencies WHERE scenario_id = ?")
      .all(current) as { depends_on: string }[];

    for (const dep of deps) {
      if (!visited.has(dep.depends_on)) {
        visited.add(dep.depends_on);
        queue.push(dep.depends_on);
      }
    }
  }

  return Array.from(visited);
}

export function topologicalSort(scenarioIds: string[]): string[] {
  const db = getDatabase();
  const idSet = new Set(scenarioIds);

  // Build adjacency list and in-degree map (only for IDs in the input set)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // depends_on -> [scenario_id, ...]

  for (const id of scenarioIds) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }

  for (const id of scenarioIds) {
    const deps = db
      .query("SELECT depends_on FROM scenario_dependencies WHERE scenario_id = ?")
      .all(id) as { depends_on: string }[];

    for (const dep of deps) {
      if (idSet.has(dep.depends_on)) {
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
        dependents.get(dep.depends_on)!.push(id);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const dep of dependents.get(current) ?? []) {
      const newDeg = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) queue.push(dep);
    }
  }

  if (sorted.length !== scenarioIds.length) {
    throw new DependencyCycleError("multiple", "multiple");
  }

  return sorted;
}

// ─── Flows ──────────────────────────────────────────────────────────────────

export function createFlow(input: CreateFlowInput): Flow {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO flows (id, project_id, name, description, scenario_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.projectId ?? null,
    input.name,
    input.description ?? null,
    JSON.stringify(input.scenarioIds),
    timestamp,
    timestamp,
  );

  return getFlow(id)!;
}

export function getFlow(id: string): Flow | null {
  const db = getDatabase();

  let row = db.query("SELECT * FROM flows WHERE id = ?").get(id) as FlowRow | null;
  if (row) return flowFromRow(row);

  // Try partial ID resolution
  const fullId = resolvePartialId("flows", id);
  if (fullId) {
    row = db.query("SELECT * FROM flows WHERE id = ?").get(fullId) as FlowRow | null;
    if (row) return flowFromRow(row);
  }

  return null;
}

export function listFlows(projectId?: string): Flow[] {
  const db = getDatabase();

  if (projectId) {
    const rows = db
      .query("SELECT * FROM flows WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as FlowRow[];
    return rows.map(flowFromRow);
  }

  const rows = db
    .query("SELECT * FROM flows ORDER BY created_at DESC")
    .all() as FlowRow[];
  return rows.map(flowFromRow);
}

export function deleteFlow(id: string): boolean {
  const db = getDatabase();
  const flow = getFlow(id);
  if (!flow) return false;

  const result = db.query("DELETE FROM flows WHERE id = ?").run(flow.id);
  return result.changes > 0;
}
