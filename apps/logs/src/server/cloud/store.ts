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
}
