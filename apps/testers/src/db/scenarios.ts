import {
  type Scenario,
  type ScenarioRow,
  type CreateScenarioInput,
  type UpdateScenarioInput,
  type ScenarioFilter,
  scenarioFromRow,
  VersionConflictError,
} from "../types/index.js";
import { getDatabase, now, uuid, shortUuid, resolvePartialId } from "./database.js";

function nextShortId(projectId?: string): string {
  const db = getDatabase();

  if (projectId) {
    const project = db
      .query("SELECT scenario_prefix, scenario_counter FROM projects WHERE id = ?")
      .get(projectId) as { scenario_prefix: string; scenario_counter: number } | null;

    if (project) {
      const next = project.scenario_counter + 1;
      db.query("UPDATE projects SET scenario_counter = ? WHERE id = ?").run(next, projectId);
      return `${project.scenario_prefix}-${next}`;
    }
  }

  // Fallback: use a global short UUID
  return shortUuid();
}

export function createScenario(input: CreateScenarioInput): Scenario {
  const db = getDatabase();
  const id = uuid();
  const short_id = nextShortId(input.projectId);
  const timestamp = now();

  db.query(`
    INSERT INTO scenarios (id, short_id, project_id, name, description, steps, tags, priority, model, timeout_ms, target_path, requires_auth, auth_config, metadata, assertions, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    id,
    short_id,
    input.projectId ?? null,
    input.name,
    input.description,
    JSON.stringify(input.steps ?? []),
    JSON.stringify(input.tags ?? []),
    input.priority ?? "medium",
    input.model ?? null,
    input.timeoutMs ?? null,
    input.targetPath ?? null,
    input.requiresAuth ? 1 : 0,
    input.authConfig ? JSON.stringify(input.authConfig) : null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    JSON.stringify(input.assertions ?? []),
    timestamp,
    timestamp,
  );

  return getScenario(id)!;
}

export function getScenario(id: string): Scenario | null {
  const db = getDatabase();

  // Direct ID lookup
  let row = db.query("SELECT * FROM scenarios WHERE id = ?").get(id) as ScenarioRow | null;
  if (row) return scenarioFromRow(row);

  // Try short_id lookup
  row = db.query("SELECT * FROM scenarios WHERE short_id = ?").get(id) as ScenarioRow | null;
  if (row) return scenarioFromRow(row);

  // Try partial ID resolution
  const fullId = resolvePartialId("scenarios", id);
  if (fullId) {
    row = db.query("SELECT * FROM scenarios WHERE id = ?").get(fullId) as ScenarioRow | null;
    if (row) return scenarioFromRow(row);
  }

  return null;
}

export function getScenarioByShortId(shortId: string): Scenario | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM scenarios WHERE short_id = ?").get(shortId) as ScenarioRow | null;
  return row ? scenarioFromRow(row) : null;
}

export function listScenarios(filter?: ScenarioFilter): Scenario[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.projectId) {
    conditions.push("project_id = ?");
    params.push(filter.projectId);
  }

  if (filter?.tags && filter.tags.length > 0) {
    for (const tag of filter.tags) {
      conditions.push("tags LIKE ?");
      params.push(`%"${tag}"%`);
    }
  }

  if (filter?.priority) {
    conditions.push("priority = ?");
    params.push(filter.priority);
  }

  if (filter?.search) {
    conditions.push("(name LIKE ? OR description LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term);
  }

  let sql = "SELECT * FROM scenarios";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  // Sort order
  const sortField = filter?.sort ?? "date";
  const sortDir = filter?.desc === false ? "ASC" : "DESC"; // default DESC
  const orderByCol =
    sortField === "name" ? "name" :
    sortField === "priority" ? "CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END" :
    "created_at";
  sql += ` ORDER BY ${orderByCol} ${sortDir}`;

  if (filter?.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }
  if (filter?.offset) {
    sql += " OFFSET ?";
    params.push(filter.offset);
  }

  const rows = db.query(sql).all(...params) as ScenarioRow[];
  const scenarios = rows.map(scenarioFromRow);

  // Compute flakiness score per scenario using last 10 results each
  if (scenarios.length === 0) return scenarios;

  const scenarioIds = scenarios.map((s) => s.id);
  const placeholders = scenarioIds.map(() => "?").join(",");

  // Subquery: get last 10 results per scenario, then aggregate
  const statsRows = db.query(`
    SELECT scenario_id,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed
    FROM (
      SELECT scenario_id, status
      FROM results
      WHERE scenario_id IN (${placeholders})
      ORDER BY created_at DESC
    )
    GROUP BY scenario_id
  `).all(...scenarioIds) as { scenario_id: string; total: number; passed: number }[];

  const statsMap = new Map(statsRows.map((r) => [r.scenario_id, r]));

  return scenarios.map((s) => {
    const stats = statsMap.get(s.id);
    return {
      ...s,
      flakinessScore: stats ? stats.passed / stats.total : null,
      recentRunCount: stats?.total ?? 0,
    };
  });
}

export function updateScenario(id: string, input: UpdateScenarioInput, version: number): Scenario {
  const db = getDatabase();
  const existing = getScenario(id);
  if (!existing) {
    throw new Error(`Scenario not found: ${id}`);
  }

  if (existing.version !== version) {
    throw new VersionConflictError("scenario", existing.id);
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }
  if (input.steps !== undefined) {
    sets.push("steps = ?");
    params.push(JSON.stringify(input.steps));
  }
  if (input.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(input.tags));
  }
  if (input.priority !== undefined) {
    sets.push("priority = ?");
    params.push(input.priority);
  }
  if (input.model !== undefined) {
    sets.push("model = ?");
    params.push(input.model);
  }
  if (input.timeoutMs !== undefined) {
    sets.push("timeout_ms = ?");
    params.push(input.timeoutMs);
  }
  if (input.targetPath !== undefined) {
    sets.push("target_path = ?");
    params.push(input.targetPath);
  }
  if (input.requiresAuth !== undefined) {
    sets.push("requires_auth = ?");
    params.push(input.requiresAuth ? 1 : 0);
  }
  if (input.authConfig !== undefined) {
    sets.push("auth_config = ?");
    params.push(JSON.stringify(input.authConfig));
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(input.metadata));
  }
  if (input.assertions !== undefined) {
    sets.push("assertions = ?");
    params.push(JSON.stringify(input.assertions));
  }

  if (sets.length === 0) {
    return existing;
  }

  sets.push("version = ?");
  params.push(version + 1);
  sets.push("updated_at = ?");
  params.push(now());

  params.push(existing.id);
  params.push(version);

  const result = db
    .query(`UPDATE scenarios SET ${sets.join(", ")} WHERE id = ? AND version = ?`)
    .run(...params);

  if (result.changes === 0) {
    throw new VersionConflictError("scenario", existing.id);
  }

  return getScenario(existing.id)!;
}

export function countScenarios(filter?: ScenarioFilter): number {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.projectId) {
    conditions.push("project_id = ?");
    params.push(filter.projectId);
  }
  if (filter?.tags && filter.tags.length > 0) {
    for (const tag of filter.tags) {
      conditions.push("tags LIKE ?");
      params.push(`%"${tag}"%`);
    }
  }
  if (filter?.priority) {
    conditions.push("priority = ?");
    params.push(filter.priority);
  }
  if (filter?.search) {
    conditions.push("(name LIKE ? OR description LIKE ?)");
    const term = `%${filter.search}%`;
    params.push(term, term);
  }

  let sql = "SELECT COUNT(*) as count FROM scenarios";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");

  const row = db.query(sql).get(...params) as { count: number };
  return row.count;
}

export interface StaleScenario extends Scenario {
  lastRunAt: string | null;
}

export function findStaleScenarios(days: number): StaleScenario[] {
  const db = getDatabase();

  // Returns scenarios where the most recent run result is older than `days` days,
  // or the scenario has never been run at all.
  const rows = db.query(`
    SELECT s.*, MAX(r.created_at) AS last_run_at
    FROM scenarios s
    LEFT JOIN results r ON r.scenario_id = s.id
    GROUP BY s.id
    HAVING last_run_at IS NULL
       OR last_run_at < datetime('now', ? || ' days')
    ORDER BY last_run_at ASC NULLS FIRST
  `).all(`-${days}`) as (ScenarioRow & { last_run_at: string | null })[];

  return rows.map((row) => ({
    ...scenarioFromRow(row),
    lastRunAt: row.last_run_at,
  }));
}

export function updateScenarioPassedCache(id: string, url: string): void {
  const db = getDatabase();
  db.query("UPDATE scenarios SET last_passed_at = ?, last_passed_url = ? WHERE id = ?")
    .run(now(), url, id);
}

export function deleteScenario(id: string): boolean {
  const db = getDatabase();
  const scenario = getScenario(id);
  if (!scenario) return false;

  const result = db.query("DELETE FROM scenarios WHERE id = ?").run(scenario.id);
  return result.changes > 0;
}
