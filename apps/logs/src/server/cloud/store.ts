/**
 * PostgreSQL-backed store for the @hasna/logs cloud serve `/v1` surface.
 *
 * PURE REMOTE per Amendment A1: every read and write goes straight to the
 * shared cloud Postgres through the vendored storage kit's typed query client.
 * There is no cache, no local mirror, and no sync engine here — the serve is a
 * thin, stateless API in front of RDS.
 */

import { randomUUID } from "node:crypto";
import type { TypedQueryClient } from "../../generated/storage-kit/index.ts";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface ProjectRecord {
  id: string;
  name: string;
  github_repo: string | null;
  base_url: string | null;
  description: string | null;
  created_at: string;
}

export interface LogRecord {
  id: string;
  timestamp: string;
  project_id: string | null;
  level: LogLevel;
  source: string;
  service: string | null;
  message: string;
  trace_id: string | null;
  session_id: string | null;
  agent: string | null;
  url: string | null;
  stack_trace: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CreateProjectInput {
  name: string;
  github_repo?: string | null;
  base_url?: string | null;
  description?: string | null;
}

export interface CreateLogInput {
  level: LogLevel;
  message: string;
  project_id?: string | null;
  source?: string | null;
  service?: string | null;
  trace_id?: string | null;
  session_id?: string | null;
  agent?: string | null;
  url?: string | null;
  stack_trace?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp?: string | null;
}

export interface ListLogsQuery {
  project_id?: string;
  level?: LogLevel;
  service?: string;
  trace_id?: string;
  q?: string;
  limit?: number;
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

interface ProjectRow {
  id: string;
  name: string;
  github_repo: string | null;
  base_url: string | null;
  description: string | null;
  created_at: string | Date;
}

interface LogRow extends Omit<LogRecord, "metadata" | "timestamp"> {
  timestamp: string | Date;
  metadata: unknown;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    github_repo: row.github_repo,
    base_url: row.base_url,
    description: row.description,
    created_at: toIso(row.created_at),
  };
}

function rowToLog(row: LogRow): LogRecord {
  return {
    id: row.id,
    timestamp: toIso(row.timestamp),
    project_id: row.project_id,
    level: row.level,
    source: row.source,
    service: row.service,
    message: row.message,
    trace_id: row.trace_id,
    session_id: row.session_id,
    agent: row.agent,
    url: row.url,
    stack_trace: row.stack_trace,
    metadata: parseMetadata(row.metadata),
  };
}

const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 1000;

/** Thin, typed CRUD over the cloud Postgres for the `/v1` API. */
export class CloudLogStore {
  constructor(private readonly client: TypedQueryClient) {}

  // --- projects ------------------------------------------------------------

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    const id = randomUUID();
    const row = await this.client.one<ProjectRow>(
      `INSERT INTO projects (id, name, github_repo, base_url, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, github_repo, base_url, description, created_at`,
      [
        id,
        input.name,
        input.github_repo ?? null,
        input.base_url ?? null,
        input.description ?? null,
      ],
    );
    return rowToProject(row);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const rows = await this.client.many<ProjectRow>(
      `SELECT id, name, github_repo, base_url, description, created_at
       FROM projects ORDER BY created_at DESC LIMIT 500`,
    );
    return rows.map(rowToProject);
  }

  async getProject(id: string): Promise<ProjectRecord | null> {
    const row = await this.client.get<ProjectRow>(
      `SELECT id, name, github_repo, base_url, description, created_at
       FROM projects WHERE id = $1`,
      [id],
    );
    return row ? rowToProject(row) : null;
  }

  async getProjectByName(name: string): Promise<ProjectRecord | null> {
    const row = await this.client.get<ProjectRow>(
      `SELECT id, name, github_repo, base_url, description, created_at
       FROM projects WHERE name = $1`,
      [name],
    );
    return row ? rowToProject(row) : null;
  }

  // --- logs ----------------------------------------------------------------

  async createLog(input: CreateLogInput): Promise<LogRecord> {
    const id = randomUUID();
    const row = await this.client.one<LogRow>(
      `INSERT INTO logs
         (id, timestamp, project_id, level, source, service, message,
          trace_id, session_id, agent, url, stack_trace, metadata)
       VALUES ($1, COALESCE($2, NOW()::text), $3, $4, $5, $6, $7,
               $8, $9, $10, $11, $12, $13)
       RETURNING id, timestamp, project_id, level, source, service, message,
                 trace_id, session_id, agent, url, stack_trace, metadata`,
      [
        id,
        input.timestamp ?? null,
        input.project_id ?? null,
        input.level,
        input.source ?? "sdk",
        input.service ?? null,
        input.message,
        input.trace_id ?? null,
        input.session_id ?? null,
        input.agent ?? null,
        input.url ?? null,
        input.stack_trace ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
    return rowToLog(row);
  }

  async listLogs(query: ListLogsQuery = {}): Promise<LogRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      clauses.push(sql.replace("$?", `$${params.length}`));
    };
    if (query.project_id) add("project_id = $?", query.project_id);
    if (query.level) add("level = $?", query.level);
    if (query.service) add("service = $?", query.service);
    if (query.trace_id) add("trace_id = $?", query.trace_id);
    if (query.q) add("message ILIKE $?", `%${query.q}%`);

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_LOG_LIMIT, 1),
      MAX_LOG_LIMIT,
    );
    params.push(limit);
    const rows = await this.client.many<LogRow>(
      `SELECT id, timestamp, project_id, level, source, service, message,
              trace_id, session_id, agent, url, stack_trace, metadata
       FROM logs ${where}
       ORDER BY timestamp DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToLog);
  }

  async getLog(id: string): Promise<LogRecord | null> {
    const row = await this.client.get<LogRow>(
      `SELECT id, timestamp, project_id, level, source, service, message,
              trace_id, session_id, agent, url, stack_trace, metadata
       FROM logs WHERE id = $1`,
      [id],
    );
    return row ? rowToLog(row) : null;
  }

  async deleteLog(id: string): Promise<boolean> {
    const row = await this.client.get<{ id: string }>(
      "DELETE FROM logs WHERE id = $1 RETURNING id",
      [id],
    );
    return row !== null;
  }

  async countLogs(): Promise<number> {
    const row = await this.client.get<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM logs",
    );
    return row ? Number(row.count) : 0;
  }

  // --- aggregates (feed the CLI/MCP data-plane over /v1) --------------------

  /** Level (and optional service) breakdown, matching the local `countLogs`. */
  async countLogsBreakdown(filters: CountLogsFilters = {}): Promise<CloudLogCount> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      clauses.push(sql.replace("$?", `$${params.length}`));
    };
    if (filters.project_id) add("project_id = $?", filters.project_id);
    if (filters.service) add("service = $?", filters.service);
    if (filters.level) add("level = $?", filters.level);
    if (filters.since) add("timestamp >= $?", filters.since);
    if (filters.until) add("timestamp <= $?", filters.until);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const levelRows = await this.client.many<{ level: string; c: string }>(
      `SELECT level, COUNT(*)::text AS c FROM logs ${where} GROUP BY level`,
      params,
    );
    const by_level: Record<string, number> = {};
    let total = 0;
    for (const r of levelRows) {
      const n = Number(r.c);
      by_level[r.level] = n;
      total += n;
    }
    const result: CloudLogCount = {
      total,
      errors: by_level.error ?? 0,
      warns: by_level.warn ?? 0,
      fatals: by_level.fatal ?? 0,
      by_level,
    };
    if (filters.group_by === "service") {
      const svcRows = await this.client.many<{ service: string | null; c: string }>(
        `SELECT service, COUNT(*)::text AS c FROM logs ${where} GROUP BY service`,
        params,
      );
      result.by_service = Object.fromEntries(
        svcRows.map((r) => [r.service ?? "(none)", Number(r.c)]),
      );
    }
    return result;
  }

  /** Error/warn/fatal counts grouped by project/service/page/level. */
  async summarize(
    projectId?: string,
    since?: string,
    until?: string,
  ): Promise<CloudLogSummary[]> {
    const clauses: string[] = ["level IN ('warn','error','fatal')"];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      clauses.push(sql.replace("$?", `$${params.length}`));
    };
    if (projectId) add("project_id = $?", projectId);
    if (since) add("timestamp >= $?", since);
    if (until) add("timestamp <= $?", until);
    const rows = await this.client.many<{
      project_id: string | null;
      service: string | null;
      level: string;
      count: string;
      latest: string | Date;
    }>(
      `SELECT project_id, service, level, COUNT(*)::text AS count,
              MAX(timestamp) AS latest
       FROM logs WHERE ${clauses.join(" AND ")}
       GROUP BY project_id, service, level
       ORDER BY count DESC`,
      params,
    );
    return rows.map((r) => ({
      project_id: r.project_id,
      service: r.service,
      page_id: null,
      level: r.level as LogLevel,
      count: Number(r.count),
      latest: toIso(r.latest),
    }));
  }

  /** A HealthResult-shaped summary for the cloud tier (logs + projects only). */
  async healthSummary(uptimeSeconds: number): Promise<CloudHealth> {
    const [projects, byLevel, bounds] = await Promise.all([
      this.client.get<{ c: string }>("SELECT COUNT(*)::text AS c FROM projects"),
      this.client.many<{ level: string; c: string }>(
        "SELECT level, COUNT(*)::text AS c FROM logs GROUP BY level",
      ),
      this.client.get<{ oldest: string | Date | null; newest: string | Date | null }>(
        "SELECT MIN(timestamp) AS oldest, MAX(timestamp) AS newest FROM logs",
      ),
    ]);
    const logs_by_level: Record<string, number> = {};
    let total_logs = 0;
    for (const r of byLevel) {
      const n = Number(r.c);
      logs_by_level[r.level] = n;
      total_logs += n;
    }
    return {
      status: "ok",
      uptime_seconds: uptimeSeconds,
      db_size_bytes: null,
      projects: projects ? Number(projects.c) : 0,
      total_logs,
      logs_by_level,
      oldest_log: bounds?.oldest ? toIso(bounds.oldest) : null,
      newest_log: bounds?.newest ? toIso(bounds.newest) : null,
      scheduler_jobs: 0,
      open_issues: 0,
    };
  }
}

export interface CountLogsFilters {
  project_id?: string;
  service?: string;
  level?: LogLevel;
  since?: string;
  until?: string;
  group_by?: "level" | "service";
}

export interface CloudLogCount {
  total: number;
  errors: number;
  warns: number;
  fatals: number;
  by_level: Record<string, number>;
  by_service?: Record<string, number>;
}

export interface CloudLogSummary {
  project_id: string | null;
  service: string | null;
  page_id: string | null;
  level: LogLevel;
  count: number;
  latest: string;
}

export interface CloudHealth {
  status: "ok";
  uptime_seconds: number;
  db_size_bytes: number | null;
  projects: number;
  total_logs: number;
  logs_by_level: Record<string, number>;
  oldest_log: string | null;
  newest_log: string | null;
  scheduler_jobs: number;
  open_issues: number;
}
