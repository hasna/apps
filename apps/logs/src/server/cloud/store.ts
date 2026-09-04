/**
 * PostgreSQL-backed store for the @hasna/logs cloud serve `/v1` surface.
 *
 * Every read and write goes straight to the shared cloud Postgres through the
 * vendored storage kit's typed query client. There is no cache, no local
 * mirror, and no sync engine here — the serve is a thin, stateless API in
 * front of RDS.
 */

import { createHash, randomUUID } from "node:crypto";
import type { TypedQueryClient } from "../../generated/storage-kit/index.ts";
import type { AlertRule } from "../../lib/alerts.ts";
import type { CompareResult } from "../../lib/compare.ts";
import type { DiagnoseInclude, DiagnosisResult } from "../../lib/diagnose.ts";
import type { TelemetryEnvelope } from "../../lib/event-store.ts";
import type { EventCatalogEntry, EventCatalogQuery } from "../../lib/events.ts";
import type { Issue } from "../../lib/issues.ts";
import { normalizeAndRedactUniversalEvent } from "../../lib/universal-ingest.ts";
import type { UniversalEventInput } from "../../lib/universal-ingest.ts";
import type { SessionContext } from "../../lib/session-context.ts";
import type {
  TestReportCaseEntry,
  TestReportEntry,
  TestReportQuery,
} from "../../lib/test-reports.ts";
import type {
  Page,
  PerformanceSnapshot,
  ScanJob,
  ScanRun,
} from "../../types/index.ts";

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
  page_id: string | null;
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
  source_event_id: string | null;
  machine_id: string | null;
  repo_id: string | null;
  app_id: string | null;
  process_id: string | null;
  run_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  release_id: string | null;
  environment: string | null;
  privacy: string | null;
}

export interface CreateProjectInput {
  name: string;
  github_repo?: string | null;
  base_url?: string | null;
  description?: string | null;
}

export interface CreateLogInput {
  /** Client-chosen deterministic id. Honored when present (dedupe parity with
   *  local ingest); a UUID is minted only when absent. */
  id?: string;
  level: LogLevel;
  message: string;
  project_id?: string | null;
  page_id?: string | null;
  source?: string | null;
  service?: string | null;
  trace_id?: string | null;
  session_id?: string | null;
  agent?: string | null;
  url?: string | null;
  stack_trace?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp?: string | null;
  source_event_id?: string | null;
  machine_id?: string | null;
  repo_id?: string | null;
  app_id?: string | null;
  process_id?: string | null;
  run_id?: string | null;
  span_id?: string | null;
  parent_span_id?: string | null;
  release_id?: string | null;
  environment?: string | null;
  privacy?: string | null;
}

export interface ListLogsQuery {
  project_id?: string;
  level?: LogLevel;
  service?: string;
  trace_id?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/** Read a non-empty string attribute from a loosely-typed record, else null. */
function strAttr(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
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

/** Column list for `logs` reads — must cover every {@link LogRecord} field. */
const LOG_SELECT_COLUMNS = `id, timestamp, project_id, page_id, level, source, service,
       message, trace_id, session_id, agent, url, stack_trace, metadata,
       source_event_id, machine_id, repo_id, app_id, process_id, run_id,
       span_id, parent_span_id, release_id, environment, privacy`;

function rowToLog(row: LogRow): LogRecord {
  return {
    id: row.id,
    timestamp: toIso(row.timestamp),
    project_id: row.project_id,
    page_id: row.page_id,
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
    source_event_id: row.source_event_id,
    machine_id: row.machine_id,
    repo_id: row.repo_id,
    app_id: row.app_id,
    process_id: row.process_id,
    run_id: row.run_id,
    span_id: row.span_id,
    parent_span_id: row.parent_span_id,
    release_id: row.release_id,
    environment: row.environment,
    privacy: row.privacy,
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
    // Honor the client's deterministic id (dedupe parity with local ingest at
    // src/lib/ingest.ts): a retry with the same id returns the existing row
    // instead of inserting a duplicate. A UUID is minted only when absent.
    const id = input.id ?? randomUUID();
    const row = await this.client.get<LogRow>(
      `INSERT INTO logs
         (id, timestamp, project_id, page_id, level, source, service, message,
          trace_id, session_id, agent, url, stack_trace, metadata,
          source_event_id, machine_id, repo_id, app_id, process_id, run_id,
          span_id, parent_span_id, release_id, environment, privacy)
       VALUES ($1, COALESCE($2, NOW()::text), $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${LOG_SELECT_COLUMNS}`,
      [
        id,
        input.timestamp ?? null,
        input.project_id ?? null,
        input.page_id ?? null,
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
        input.source_event_id ?? null,
        input.machine_id ?? null,
        input.repo_id ?? null,
        input.app_id ?? null,
        input.process_id ?? null,
        input.run_id ?? null,
        input.span_id ?? null,
        input.parent_span_id ?? null,
        input.release_id ?? null,
        input.environment ?? null,
        input.privacy ?? null,
      ],
    );
    if (row) return rowToLog(row);
    // ON CONFLICT (id) DO NOTHING — the row already exists; return it.
    const existing = await this.getLog(id);
    if (!existing) {
      throw new Error(`Log row disappeared after insert: ${id}`);
    }
    return existing;
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
    // Mirror lib/query.ts: clamp a finite offset (negative/NaN -> 0).
    const offset = Math.max(
      0,
      Math.floor(Number.isFinite(query.offset) ? query.offset! : 0),
    );
    params.push(offset);
    const rows = await this.client.many<LogRow>(
      `SELECT ${LOG_SELECT_COLUMNS}
       FROM logs ${where}
       ORDER BY timestamp DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map(rowToLog);
  }

  async getLog(id: string): Promise<LogRecord | null> {
    const row = await this.client.get<LogRow>(
      `SELECT ${LOG_SELECT_COLUMNS}
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
  async countLogsBreakdown(
    filters: CountLogsFilters = {},
  ): Promise<CloudLogCount> {
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
      const svcRows = await this.client.many<{
        service: string | null;
        c: string;
      }>(
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
      this.client.get<{ c: string }>(
        "SELECT COUNT(*)::text AS c FROM projects",
      ),
      this.client.many<{ level: string; c: string }>(
        "SELECT level, COUNT(*)::text AS c FROM logs GROUP BY level",
      ),
      this.client.get<{
        oldest: string | Date | null;
        newest: string | Date | null;
      }>("SELECT MIN(timestamp) AS oldest, MAX(timestamp) AS newest FROM logs"),
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
      scheduler_jobs: await this.countScanJobs(),
      open_issues: await this.countOpenIssues(),
    };
  }

  private async countScanJobs(): Promise<number> {
    const row = await this.client.get<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM scan_jobs",
    );
    return row ? Number(row.c) : 0;
  }

  private async countOpenIssues(): Promise<number> {
    const row = await this.client.get<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM issues WHERE status = 'open'",
    );
    return row ? Number(row.c) : 0;
  }

  // --- pages ---------------------------------------------------------------

  async listPages(projectId: string): Promise<Page[]> {
    const rows = await this.client.many<PageRow>(
      `SELECT id, project_id, url, path, name, last_scanned_at, created_at
       FROM pages WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId],
    );
    return rows.map(rowToPage);
  }

  async createPage(input: {
    project_id: string;
    url: string;
    path?: string;
    name?: string;
  }): Promise<Page> {
    const row = await this.client.one<PageRow>(
      `INSERT INTO pages (project_id, url, path, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, url) DO UPDATE SET
         path = EXCLUDED.path, name = COALESCE(EXCLUDED.name, pages.name)
       RETURNING id, project_id, url, path, name, last_scanned_at, created_at`,
      [
        input.project_id,
        input.url,
        input.path ?? new URL(input.url).pathname,
        input.name ?? null,
      ],
    );
    return rowToPage(row);
  }

  // --- scan jobs -----------------------------------------------------------

  async listJobs(projectId?: string): Promise<ScanJob[]> {
    const rows = projectId
      ? await this.client.many<ScanJobRow>(
          `SELECT id, project_id, page_id, schedule, enabled, last_run_at, created_at
           FROM scan_jobs WHERE project_id = $1 ORDER BY created_at DESC`,
          [projectId],
        )
      : await this.client.many<ScanJobRow>(
          `SELECT id, project_id, page_id, schedule, enabled, last_run_at, created_at
           FROM scan_jobs ORDER BY created_at DESC`,
        );
    return rows.map(rowToScanJob);
  }

  async createJob(input: {
    project_id: string;
    schedule: string;
    page_id?: string;
  }): Promise<ScanJob> {
    const row = await this.client.one<ScanJobRow>(
      `INSERT INTO scan_jobs (project_id, page_id, schedule)
       VALUES ($1, $2, $3)
       RETURNING id, project_id, page_id, schedule, enabled, last_run_at, created_at`,
      [input.project_id, input.page_id ?? null, input.schedule],
    );
    return rowToScanJob(row);
  }

  async getJob(id: string): Promise<ScanJob | null> {
    const row = await this.client.get<ScanJobRow>(
      `SELECT id, project_id, page_id, schedule, enabled, last_run_at, created_at
       FROM scan_jobs WHERE id = $1`,
      [id],
    );
    return row ? rowToScanJob(row) : null;
  }

  async updateJob(
    id: string,
    data: { enabled?: boolean; schedule?: string; last_run_at?: string },
  ): Promise<ScanJob | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.enabled !== undefined) {
      sets.push(`enabled = $${params.length + 1}`);
      params.push(data.enabled);
    }
    if (data.schedule !== undefined) {
      sets.push(`schedule = $${params.length + 1}`);
      params.push(data.schedule);
    }
    if (data.last_run_at !== undefined) {
      sets.push(`last_run_at = $${params.length + 1}`);
      params.push(data.last_run_at);
    }
    if (sets.length === 0) return this.getJob(id);
    params.push(id);
    const row = await this.client.get<ScanJobRow>(
      `UPDATE scan_jobs SET ${sets.join(", ")}
       WHERE id = $${params.length}
       RETURNING id, project_id, page_id, schedule, enabled, last_run_at, created_at`,
      params,
    );
    return row ? rowToScanJob(row) : null;
  }

  async createScanRun(input: {
    job_id: string;
    page_id?: string;
  }): Promise<ScanRun> {
    const row = await this.client.one<ScanRunRow>(
      `INSERT INTO scan_runs (job_id, page_id) VALUES ($1, $2)
       RETURNING id, job_id, page_id, started_at, finished_at, status,
                 logs_collected, errors_found, perf_score`,
      [input.job_id, input.page_id ?? null],
    );
    return rowToScanRun(row);
  }

  async finishScanRun(
    id: string,
    data: {
      status: "completed" | "failed";
      logs_collected: number;
      errors_found: number;
      perf_score?: number;
    },
  ): Promise<ScanRun | null> {
    const row = await this.client.get<ScanRunRow>(
      `UPDATE scan_runs SET finished_at = NOW()::text, status = $1,
        logs_collected = $2, errors_found = $3, perf_score = $4
       WHERE id = $5
       RETURNING id, job_id, page_id, started_at, finished_at, status,
                 logs_collected, errors_found, perf_score`,
      [
        data.status,
        data.logs_collected,
        data.errors_found,
        data.perf_score ?? null,
        id,
      ],
    );
    return row ? rowToScanRun(row) : null;
  }

  // --- pages ---------------------------------------------------------------

  async getPage(pageId: string): Promise<Page | null> {
    const row = await this.client.get<PageRow>(
      `SELECT id, project_id, url, path, name, last_scanned_at, created_at
       FROM pages WHERE id = $1`,
      [pageId],
    );
    return row ? rowToPage(row) : null;
  }

  async touchPage(pageId: string, lastScannedAt: string): Promise<Page | null> {
    const row = await this.client.get<PageRow>(
      `UPDATE pages SET last_scanned_at = $2
       WHERE id = $1
       RETURNING id, project_id, url, path, name, last_scanned_at, created_at`,
      [pageId, lastScannedAt],
    );
    return row ? rowToPage(row) : null;
  }

  // --- performance ---------------------------------------------------------

  async savePerfSnapshot(
    data: Omit<PerformanceSnapshot, "id" | "timestamp">,
  ): Promise<PerformanceSnapshot> {
    return this.client.one<PerformanceSnapshot>(
      `INSERT INTO performance_snapshots
         (project_id, page_id, url, lcp, fcp, cls, tti, ttfb, score, raw_audit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        data.project_id,
        data.page_id ?? null,
        data.url,
        data.lcp ?? null,
        data.fcp ?? null,
        data.cls ?? null,
        data.tti ?? null,
        data.ttfb ?? null,
        data.score ?? null,
        data.raw_audit ?? null,
      ],
    );
  }

  // --- performance ---------------------------------------------------------

  async latestPerfSnapshot(
    projectId: string,
    pageId?: string,
  ): Promise<PerformanceSnapshot | null> {
    const row = pageId
      ? await this.client.get<PerformanceSnapshot>(
          `SELECT * FROM performance_snapshots
           WHERE project_id = $1 AND page_id = $2
           ORDER BY timestamp DESC LIMIT 1`,
          [projectId, pageId],
        )
      : await this.client.get<PerformanceSnapshot>(
          `SELECT * FROM performance_snapshots
           WHERE project_id = $1 ORDER BY timestamp DESC LIMIT 1`,
          [projectId],
        );
    return row ? { ...row, timestamp: toIso(row.timestamp) } : null;
  }

  async perfTrend(
    projectId: string,
    pageId?: string,
    since?: string,
    limit = 50,
  ): Promise<PerformanceSnapshot[]> {
    const clauses = ["project_id = $1"];
    const params: unknown[] = [projectId];
    if (pageId) {
      params.push(pageId);
      clauses.push(`page_id = $${params.length}`);
    }
    if (since) {
      params.push(since);
      clauses.push(`timestamp >= $${params.length}`);
    }
    params.push(Math.min(Math.max(limit, 1), 1000));
    const rows = await this.client.many<PerformanceSnapshot>(
      `SELECT * FROM performance_snapshots WHERE ${clauses.join(" AND ")}
       ORDER BY timestamp DESC LIMIT $${params.length}`,
      params,
    );
    return rows.map((r) => ({ ...r, timestamp: toIso(r.timestamp) }));
  }

  // --- issues --------------------------------------------------------------

  async listIssues(
    projectId?: string,
    status?: string,
    limit = 50,
  ): Promise<Issue[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (projectId) {
      params.push(projectId);
      clauses.push(`project_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(Math.min(Math.max(limit, 1), 1000));
    return this.client.many<Issue>(
      `SELECT id, project_id, fingerprint, level, service, message_template,
              first_seen, last_seen, count, status
       FROM issues ${where} ORDER BY last_seen DESC LIMIT $${params.length}`,
      params,
    );
  }

  async updateIssueStatus(
    id: string,
    status: "open" | "resolved" | "ignored",
  ): Promise<Issue | null> {
    const row = await this.client.get<Issue>(
      `UPDATE issues SET status = $2 WHERE id = $1
       RETURNING id, project_id, fingerprint, level, service, message_template,
                 first_seen, last_seen, count, status`,
      [id, status],
    );
    return row ?? null;
  }

  // --- alert rules ---------------------------------------------------------

  async createAlertRule(input: {
    project_id: string;
    name: string;
    service?: string;
    level?: string;
    threshold_count?: number;
    window_seconds?: number;
    action?: "webhook" | "log";
    webhook_url?: string;
  }): Promise<AlertRule> {
    const row = await this.client.one<AlertRuleRow>(
      `INSERT INTO alert_rules
         (project_id, name, service, level, threshold_count, window_seconds, action, webhook_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, project_id, name, service, level, threshold_count,
                 window_seconds, action, webhook_url, enabled, last_fired_at, created_at`,
      [
        input.project_id,
        input.name,
        input.service ?? null,
        input.level ?? "error",
        input.threshold_count ?? 10,
        input.window_seconds ?? 60,
        input.action ?? "webhook",
        input.webhook_url ?? null,
      ],
    );
    return rowToAlertRule(row);
  }

  async listAlertRules(projectId?: string): Promise<AlertRule[]> {
    const rows = projectId
      ? await this.client.many<AlertRuleRow>(
          `SELECT id, project_id, name, service, level, threshold_count,
                  window_seconds, action, webhook_url, enabled, last_fired_at, created_at
           FROM alert_rules WHERE project_id = $1 ORDER BY created_at DESC`,
          [projectId],
        )
      : await this.client.many<AlertRuleRow>(
          `SELECT id, project_id, name, service, level, threshold_count,
                  window_seconds, action, webhook_url, enabled, last_fired_at, created_at
           FROM alert_rules ORDER BY created_at DESC`,
        );
    return rows.map(rowToAlertRule);
  }

  async deleteAlertRule(id: string): Promise<void> {
    await this.client.get<{ id: string }>(
      "DELETE FROM alert_rules WHERE id = $1 RETURNING id",
      [id],
    );
  }

  // --- feedback ------------------------------------------------------------

  async recordFeedback(
    message: string,
    email: string | null,
    category: string,
    version: string,
  ): Promise<void> {
    await this.client.one<{ id: string }>(
      `INSERT INTO feedback (message, email, category, version)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [message, email, category, version],
    );
  }

  // --- session context -----------------------------------------------------

  async sessionContext(sessionId: string): Promise<SessionContext> {
    const rows = await this.client.many<LogRow>(
      `SELECT ${LOG_SELECT_COLUMNS}
       FROM logs WHERE session_id = $1 ORDER BY timestamp ASC`,
      [sessionId],
    );
    return {
      session_id: sessionId,
      logs: rows.map(rowToLog) as unknown as SessionContext["logs"],
    };
  }

  // --- log context by id ---------------------------------------------------

  async logContextFromId(logId: string, window = 0): Promise<LogRecord[]> {
    const log = await this.getLog(logId);
    if (!log) return [];
    const trace = log.trace_id
      ? await this.listLogs({ trace_id: log.trace_id, limit: 1000 }).then(
          (rows) =>
            rows.sort((a, b) =>
              a.timestamp < b.timestamp
                ? -1
                : a.timestamp > b.timestamp
                  ? 1
                  : 0,
            ),
        )
      : [log];
    if (window <= 0) return trace;
    const before = await this.client
      .many<LogRow>(
        `SELECT ${LOG_SELECT_COLUMNS}
         FROM logs WHERE id != $1 AND timestamp <= $2
         ORDER BY timestamp DESC LIMIT $3`,
        [logId, log.timestamp, window],
      )
      .then((rows) => rows.map(rowToLog));
    const after = await this.client
      .many<LogRow>(
        `SELECT ${LOG_SELECT_COLUMNS}
         FROM logs WHERE id != $1 AND timestamp > $2
         ORDER BY timestamp ASC LIMIT $3`,
        [logId, log.timestamp, window],
      )
      .then((rows) => rows.map(rowToLog));
    const seen = new Set<string>();
    const merged: LogRecord[] = [];
    for (const row of [...before.reverse(), ...trace, ...after]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        merged.push(row);
      }
    }
    return merged.sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
    );
  }

  // --- events catalog (ingest + read) -------------------------------------

  /**
   * Ingest one universal telemetry event into the shared hosted event catalog.
   *
   * The input is validated + normalized + redacted by the SAME DB-agnostic pass
   * the local SQLite store uses, so secrets never reach Postgres. Ingest is
   * idempotent on `event_id`: a re-post returns the stored event with
   * `inserted: false`. The raw envelope body is NOT persisted in the hosted
   * tier (it lives only in local append-only segments), so the segment
   * coordinates are empty placeholders and `getEvent` always returns
   * `raw: null`.
   */
  async createEvent(
    input: UniversalEventInput,
  ): Promise<{ inserted: boolean; event: EventCatalogEntry }> {
    const { envelope, metadata } = normalizeAndRedactUniversalEvent(input);

    const existing = await this.getEvent(envelope.event_id);
    if (existing) return { inserted: false, event: existing };

    const attrs = envelope.attributes ?? {};
    const body = envelope.body ?? {};
    const projectId = strAttr(attrs, "project_id");
    const pageId = strAttr(attrs, "page_id");
    const artifactId =
      strAttr(attrs, "artifact_id") ?? strAttr(body, "artifact_id");
    // Stable content hash of the redacted envelope (no raw segment hosted).
    const recordHash = createHash("sha256")
      .update(JSON.stringify(envelope))
      .digest("hex");

    await this.client.execute(
      `INSERT INTO event_records
         (event_id, schema_version, source_event_id, event_type, event_time,
          ingest_time, severity, source, project_id, page_id, log_id, machine_id,
          repo_id, app_id, process_id, run_id, trace_id, span_id, parent_span_id,
          session_id, release_id, environment, artifact_id, privacy_tier,
          segment_id, segment_path, byte_offset, byte_length, record_hash,
          message, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        envelope.event_id,
        envelope.schema_version,
        envelope.source_event_id ?? null,
        envelope.type,
        envelope.event_time,
        envelope.ingest_time,
        envelope.severity ?? null,
        envelope.source,
        projectId,
        pageId,
        null,
        envelope.machine_id ?? null,
        envelope.repo_id ?? null,
        envelope.app_id ?? null,
        envelope.process_id ?? null,
        envelope.run_id ?? null,
        envelope.trace_id ?? null,
        envelope.span_id ?? null,
        envelope.parent_span_id ?? null,
        envelope.session_id ?? null,
        envelope.release_id ?? null,
        envelope.environment ?? null,
        artifactId,
        envelope.privacy ?? null,
        // No local segment coordinates exist on the hosted path: the raw
        // envelope body is not persisted, so the segment columns carry empty
        // placeholders (segment_path is NOT NULL in the schema).
        "",
        "",
        0,
        0,
        recordHash,
        envelope.message ?? null,
        JSON.stringify(metadata ?? {}),
      ],
    );

    const event = await this.getEvent(envelope.event_id);
    if (!event) {
      throw new Error(
        `Event was written but cannot be read: ${envelope.event_id}`,
      );
    }
    return { inserted: true, event };
  }

  async searchEvents(
    query: EventCatalogQuery = {},
  ): Promise<EventCatalogEntry[]> {
    const { where, params } = buildEventWhere(query);
    const limit = clampInt(query.limit, 100, query.max_limit ?? 1000);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    params.push(limit, offset);
    const ascending = query.order === "asc";
    const rows = await this.client.many<EventRecordRow>(
      `SELECT * FROM event_records ${where}
       ORDER BY event_time ${ascending ? "ASC" : "DESC"}, event_id ${ascending ? "ASC" : "DESC"}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map(rowToEvent);
  }

  async getEvent(eventId: string): Promise<EventCatalogEntry | null> {
    const row = await this.client.get<EventRecordRow>(
      "SELECT * FROM event_records WHERE event_id = $1",
      [eventId],
    );
    // Raw envelope lives in local segment files only; the hosted tier has no
    // segments, so raw is null.
    return row ? rowToEvent(row) : null;
  }

  // --- test reports --------------------------------------------------------

  async searchTestReports(
    query: TestReportQuery = {},
  ): Promise<TestReportEntry[]> {
    const { where, params } = buildTestReportWhere(query);
    const limit = clampInt(query.limit, 100, query.max_limit ?? 1000);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    params.push(limit, offset);
    const rows = await this.client.many<TestReportRow>(
      `SELECT * FROM test_reports ${where}
       ORDER BY event_time DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const reports = rows.map(rowToTestReport);
    if (query.include_cases === true && reports.length > 0) {
      const ids = reports.map((r) => r.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
      const caseRows = await this.client.many<TestCaseRow>(
        `SELECT * FROM test_cases WHERE report_id IN (${placeholders})
         ORDER BY report_id ASC, suite_index ASC, case_index ASC, id ASC`,
        ids,
      );
      const byReport = new Map<string, TestReportCaseEntry[]>();
      for (const id of ids) byReport.set(id, []);
      for (const row of caseRows)
        byReport.get(row.report_id)?.push(rowToCase(row));
      for (const report of reports)
        report.cases = byReport.get(report.id) ?? [];
    }
    return reports;
  }

  async getTestReport(
    reportId: string,
    includeCases = true,
  ): Promise<TestReportEntry | null> {
    const row = await this.client.get<TestReportRow>(
      "SELECT * FROM test_reports WHERE id = $1",
      [reportId],
    );
    if (!row) return null;
    const report = rowToTestReport(row);
    if (includeCases) {
      const caseRows = await this.client.many<TestCaseRow>(
        `SELECT * FROM test_cases WHERE report_id = $1
         ORDER BY suite_index ASC, case_index ASC, id ASC`,
        [reportId],
      );
      report.cases = caseRows.map(rowToCase);
    }
    return report;
  }

  // --- diagnose ------------------------------------------------------------

  async diagnose(
    projectId: string,
    since?: string,
    include?: DiagnoseInclude[],
  ): Promise<DiagnosisResult> {
    const window =
      since ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const all = !include || include.length === 0;
    const want = (k: DiagnoseInclude) => all || include?.includes(k);

    const top_errors = want("top_errors")
      ? await this.client.many<DiagnosisResult["top_errors"][number]>(
          `SELECT message, COUNT(*)::int as count, service, MAX(timestamp) as last_seen
           FROM logs
           WHERE project_id = $1 AND level IN ('error','fatal') AND timestamp >= $2
           GROUP BY message, service ORDER BY count DESC LIMIT 10`,
          [projectId, window],
        )
      : [];

    const error_rate_by_service = want("error_rate")
      ? await this.client.many<
          DiagnosisResult["error_rate_by_service"][number]
        >(
          `SELECT service,
             SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END)::int as errors,
             SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END)::int as warns,
             COUNT(*)::int as total
           FROM logs WHERE project_id = $1 AND timestamp >= $2
           GROUP BY service ORDER BY errors DESC`,
          [projectId, window],
        )
      : [];

    const failing_pages = want("failing_pages")
      ? await this.client.many<DiagnosisResult["failing_pages"][number]>(
          `SELECT l.page_id, p.url, COUNT(*)::int as error_count
           FROM logs l JOIN pages p ON p.id = l.page_id
           WHERE l.project_id = $1 AND l.level IN ('error','fatal')
             AND l.timestamp >= $2 AND l.page_id IS NOT NULL
           GROUP BY l.page_id, p.url ORDER BY error_count DESC LIMIT 10`,
          [projectId, window],
        )
      : [];

    const perf_regressions = want("perf")
      ? await this.client.many<DiagnosisResult["perf_regressions"][number]>(
          `SELECT * FROM (
             SELECT cur.page_id, p.url, cur.score as score_now,
                    prev.score as score_prev, (cur.score - prev.score) as delta
             FROM performance_snapshots cur
             JOIN pages p ON p.id = cur.page_id
             LEFT JOIN performance_snapshots prev
               ON prev.page_id = cur.page_id AND prev.id != cur.id
             WHERE cur.project_id = $1
               AND cur.timestamp = (SELECT MAX(timestamp) FROM performance_snapshots WHERE page_id = cur.page_id)
               AND (prev.timestamp = (SELECT MAX(timestamp) FROM performance_snapshots WHERE page_id = cur.page_id AND id != cur.id) OR prev.id IS NULL)
           ) AS regr WHERE delta < -5 OR delta IS NULL
           ORDER BY delta ASC LIMIT 10`,
          [projectId],
        )
      : [];

    const totalErrors = top_errors.reduce((s, e) => s + e.count, 0);
    const totalWarns = error_rate_by_service.reduce((s, r) => s + r.warns, 0);
    const topService = error_rate_by_service[0];
    const score: "green" | "yellow" | "red" =
      totalErrors === 0 ? "green" : totalErrors <= 10 ? "yellow" : "red";
    const summary =
      totalErrors === 0
        ? "No errors in this window. All looks good."
        : `${totalErrors} error(s) detected. Worst service: ${topService?.service ?? "unknown"} (${topService?.errors ?? 0} errors). ${failing_pages.length} page(s) with errors. ${perf_regressions.length} perf regression(s).`;

    return {
      project_id: projectId,
      window,
      score,
      error_count: totalErrors,
      warn_count: totalWarns,
      has_perf_regression: perf_regressions.length > 0,
      top_errors,
      error_rate_by_service,
      failing_pages,
      perf_regressions,
      summary,
    };
  }

  // --- compare -------------------------------------------------------------

  async compare(
    projectId: string,
    aSince: string,
    aUntil: string,
    bSince: string,
    bUntil: string,
  ): Promise<CompareResult> {
    const errsByMsg = (since: string, until: string) =>
      this.client.many<{
        message: string;
        service: string | null;
        count: number;
      }>(
        `SELECT message, service, COUNT(*)::int as count FROM logs
         WHERE project_id = $1 AND level IN ('error','fatal')
           AND timestamp >= $2 AND timestamp <= $3
         GROUP BY message, service`,
        [projectId, since, until],
      );
    const errsBySvc = (since: string, until: string) =>
      this.client.many<{ service: string | null; errors: number }>(
        `SELECT service, COUNT(*)::int as errors FROM logs
         WHERE project_id = $1 AND level IN ('error','fatal')
           AND timestamp >= $2 AND timestamp <= $3
         GROUP BY service`,
        [projectId, since, until],
      );

    const [errorsA, errorsB, svcA, svcB] = await Promise.all([
      errsByMsg(aSince, aUntil),
      errsByMsg(bSince, bUntil),
      errsBySvc(aSince, aUntil),
      errsBySvc(bSince, bUntil),
    ]);

    const keyA = new Set(errorsA.map((e) => `${e.service}|${e.message}`));
    const keyB = new Set(errorsB.map((e) => `${e.service}|${e.message}`));
    const new_errors = errorsB.filter(
      (e) => !keyA.has(`${e.service}|${e.message}`),
    );
    const resolved_errors = errorsA.filter(
      (e) => !keyB.has(`${e.service}|${e.message}`),
    );

    const svcMapA = new Map(svcA.map((s) => [s.service, s.errors]));
    const svcMapB = new Map(svcB.map((s) => [s.service, s.errors]));
    const allSvcs = new Set([...svcMapA.keys(), ...svcMapB.keys()]);
    const error_delta_by_service = [...allSvcs]
      .map((svc) => ({
        service: svc,
        errors_a: svcMapA.get(svc) ?? 0,
        errors_b: svcMapB.get(svc) ?? 0,
        delta: (svcMapB.get(svc) ?? 0) - (svcMapA.get(svc) ?? 0),
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const perf_delta_by_page = await this.client.many<
      CompareResult["perf_delta_by_page"][number]
    >(
      `SELECT pa.page_id, pg.url, pa.score as score_a, pb.score as score_b,
              (pb.score - pa.score) as delta
       FROM (SELECT page_id, AVG(score) as score FROM performance_snapshots
             WHERE project_id = $1 AND timestamp >= $2 AND timestamp <= $3 GROUP BY page_id) pa
       JOIN pages pg ON pg.id = pa.page_id
       LEFT JOIN (SELECT page_id, AVG(score) as score FROM performance_snapshots
                  WHERE project_id = $1 AND timestamp >= $4 AND timestamp <= $5 GROUP BY page_id) pb
         ON pb.page_id = pa.page_id
       ORDER BY delta ASC`,
      [projectId, aSince, aUntil, bSince, bUntil],
    );

    const summary = [
      `${new_errors.length} new error type(s), ${resolved_errors.length} resolved.`,
      error_delta_by_service
        .filter((s) => s.delta > 0)
        .map((s) => `${s.service ?? "unknown"}: +${s.delta}`)
        .join(", ") || "No error increases.",
    ].join(" ");

    return {
      project_id: projectId,
      window_a: { since: aSince, until: aUntil },
      window_b: { since: bSince, until: bUntil },
      new_errors,
      resolved_errors,
      error_delta_by_service,
      perf_delta_by_page,
      summary,
    };
  }
}

// --- row mappers & query builders for the extended data-plane -------------

interface PageRow {
  id: string;
  project_id: string;
  url: string;
  path: string;
  name: string | null;
  last_scanned_at: string | null;
  created_at: string | Date;
}

function rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    project_id: row.project_id,
    url: row.url,
    path: row.path,
    name: row.name,
    last_scanned_at: row.last_scanned_at,
    created_at: toIso(row.created_at),
  };
}

interface ScanJobRow {
  id: string;
  project_id: string;
  page_id: string | null;
  schedule: string;
  enabled: boolean | number;
  last_run_at: string | null;
  created_at: string | Date;
}

function rowToScanJob(row: ScanJobRow): ScanJob {
  return {
    id: row.id,
    project_id: row.project_id,
    page_id: row.page_id,
    schedule: row.schedule,
    enabled: row.enabled ? 1 : 0,
    last_run_at: row.last_run_at,
    created_at: toIso(row.created_at),
  };
}

interface ScanRunRow {
  id: string;
  job_id: string;
  page_id: string | null;
  started_at: string | Date;
  finished_at: string | null;
  status: "running" | "completed" | "failed";
  logs_collected: number;
  errors_found: number;
  perf_score: number | null;
}

function rowToScanRun(row: ScanRunRow): ScanRun {
  return {
    id: row.id,
    job_id: row.job_id,
    page_id: row.page_id,
    started_at: toIso(row.started_at),
    finished_at: row.finished_at ? toIso(row.finished_at) : null,
    status: row.status,
    logs_collected: row.logs_collected,
    errors_found: row.errors_found,
    perf_score: row.perf_score,
  };
}

interface AlertRuleRow {
  id: string;
  project_id: string;
  name: string;
  service: string | null;
  level: string;
  threshold_count: number;
  window_seconds: number;
  action: "webhook" | "log";
  webhook_url: string | null;
  enabled: boolean | number;
  last_fired_at: string | null;
  created_at: string | Date;
}

function rowToAlertRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    service: row.service,
    level: row.level,
    threshold_count: row.threshold_count,
    window_seconds: row.window_seconds,
    action: row.action,
    webhook_url: row.webhook_url,
    enabled: row.enabled ? 1 : 0,
    last_fired_at: row.last_fired_at,
    created_at: toIso(row.created_at),
  };
}

interface EventRecordRow {
  event_id: string;
  schema_version: number;
  source_event_id: string | null;
  event_type: string;
  event_time: string | Date;
  ingest_time: string | Date;
  severity: string | null;
  source: string;
  project_id: string | null;
  page_id: string | null;
  log_id: string | null;
  machine_id: string | null;
  repo_id: string | null;
  app_id: string | null;
  process_id: string | null;
  run_id: string | null;
  trace_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  session_id: string | null;
  release_id: string | null;
  environment: string | null;
  artifact_id: string | null;
  privacy_tier: string | null;
  segment_id: string;
  segment_path: string;
  byte_offset: number;
  byte_length: number;
  record_hash: string;
  message: string | null;
  metadata: string | null;
  created_at: string | Date;
}

function rowToEvent(row: EventRecordRow): EventCatalogEntry {
  const { metadata, event_time, ingest_time, created_at, ...rest } = row;
  return {
    ...rest,
    event_time: toIso(event_time),
    ingest_time: toIso(ingest_time),
    created_at: toIso(created_at),
    metadata: parseMetadata(metadata),
    raw: null,
  };
}

function buildEventWhere(query: EventCatalogQuery): {
  where: string;
  params: unknown[];
} {
  const conds: string[] = [];
  const params: unknown[] = [];
  const eq = (col: string, val: string | undefined | null) => {
    if (!val) return;
    params.push(val);
    conds.push(`${col} = $${params.length}`);
  };
  const inList = (col: string, val: string | string[] | undefined) => {
    if (!val) return;
    const vals = (Array.isArray(val) ? val : val.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (vals.length === 0) return;
    const ph = vals.map((v) => {
      params.push(v);
      return `$${params.length}`;
    });
    conds.push(`${col} IN (${ph.join(",")})`);
  };
  eq("event_id", query.event_id);
  inList("event_type", query.event_type);
  inList("source", query.source);
  inList("severity", query.severity);
  eq("project_id", query.project_id);
  eq("page_id", query.page_id);
  eq("machine_id", query.machine_id);
  eq("repo_id", query.repo_id);
  eq("app_id", query.app_id);
  eq("process_id", query.process_id);
  eq("run_id", query.run_id);
  eq("trace_id", query.trace_id);
  eq("span_id", query.span_id);
  eq("session_id", query.session_id);
  eq("release_id", query.release_id);
  eq("environment", query.environment);
  if (query.since) {
    params.push(query.since);
    conds.push(`event_time >= $${params.length}`);
  }
  if (query.until) {
    params.push(query.until);
    conds.push(`event_time <= $${params.length}`);
  }
  if (query.text) {
    const needle = `%${escapeLike(query.text)}%`;
    const base = params.length;
    params.push(needle, needle, needle, needle);
    conds.push(
      `(event_id ILIKE $${base + 1} ESCAPE '\\' OR source_event_id ILIKE $${base + 2} ESCAPE '\\' OR message ILIKE $${base + 3} ESCAPE '\\' OR metadata ILIKE $${base + 4} ESCAPE '\\')`,
    );
  }
  if (query.exclude_mcp_tool_telemetry) {
    params.push('%"category":"mcp_tool_call"%');
    conds.push(
      `NOT (event_type = 'agent' AND source = 'mcp' AND metadata ILIKE $${params.length})`,
    );
  }
  if (query.after_time && query.after_id) {
    // Exclusive (event_time, event_id) cursor — the hosted counterpart of the
    // local rowid cursor used by the event-catalog live-tail.
    params.push(query.after_time, query.after_time, query.after_id);
    conds.push(
      `(event_time > $${params.length - 2} OR (event_time = $${params.length - 1} AND event_id > $${params.length}))`,
    );
  }
  return {
    where: conds.length ? `WHERE ${conds.join(" AND ")}` : "",
    params,
  };
}

interface TestReportRow {
  truncated: boolean | number;
  metadata: string | null;
  created_at: string | Date;
  event_time: string | null;
  [key: string]: unknown;
}

function rowToTestReport(row: TestReportRow): TestReportEntry {
  return {
    ...(row as unknown as TestReportEntry),
    truncated: Boolean(row.truncated),
    metadata: parseMetadata(row.metadata),
    created_at: toIso(row.created_at),
  };
}

interface TestCaseRow {
  report_id: string;
  metadata: string | null;
  created_at: string | Date;
  [key: string]: unknown;
}

function rowToCase(row: TestCaseRow): TestReportCaseEntry {
  return {
    ...(row as unknown as TestReportCaseEntry),
    metadata: parseMetadata(row.metadata),
    created_at: toIso(row.created_at),
  };
}

function buildTestReportWhere(query: TestReportQuery): {
  where: string;
  params: unknown[];
} {
  const conds: string[] = [];
  const params: unknown[] = [];
  const eq = (col: string, val: string | null | undefined) => {
    if (!val) return;
    params.push(val);
    conds.push(`${col} = $${params.length}`);
  };
  const min = (col: string, val: number | undefined) => {
    if (!Number.isFinite(val) || val === undefined) return;
    params.push(Math.max(0, Math.floor(val)));
    conds.push(`COALESCE(${col}, 0) >= $${params.length}`);
  };
  eq("id", query.report_id);
  eq("event_id", query.event_id);
  eq("project_id", query.project_id ?? undefined);
  eq("machine_id", query.machine_id);
  eq("repo_id", query.repo_id);
  eq("app_id", query.app_id);
  eq("process_id", query.process_id);
  eq("run_id", query.run_id);
  eq("environment", query.environment);
  eq("source", query.source);
  eq("parser", query.parser);
  eq("parse_status", query.parse_status);
  eq("path", query.path);
  if (query.case_status) {
    params.push(query.case_status);
    conds.push(
      `EXISTS (SELECT 1 FROM test_cases WHERE test_cases.report_id = test_reports.id AND test_cases.status = $${params.length})`,
    );
  }
  if (query.outcome === "failed") conds.push("COALESCE(failures, 0) > 0");
  else if (query.outcome === "error") conds.push("COALESCE(errors, 0) > 0");
  else if (query.outcome === "nonpassing")
    conds.push("(COALESCE(failures, 0) > 0 OR COALESCE(errors, 0) > 0)");
  else if (query.outcome === "skipped") conds.push("COALESCE(skipped, 0) > 0");
  else if (query.outcome === "passed")
    conds.push(
      "parse_status = 'parsed' AND COALESCE(failures, 0) = 0 AND COALESCE(errors, 0) = 0",
    );
  else if (query.outcome === "parse_problem")
    conds.push("(parse_status IS NULL OR parse_status != 'parsed')");
  min("failures", query.min_failures);
  min("errors", query.min_errors);
  min("skipped", query.min_skipped);
  if (query.since) {
    params.push(query.since);
    conds.push(`event_time >= $${params.length}`);
  }
  if (query.until) {
    params.push(query.until);
    conds.push(`event_time <= $${params.length}`);
  }
  if (query.text) {
    const needle = `%${escapeLike(query.text)}%`;
    const b = params.length;
    params.push(needle, needle, needle, needle, needle, needle, needle, needle);
    conds.push(`(
      id ILIKE $${b + 1} ESCAPE '\\' OR event_id ILIKE $${b + 2} ESCAPE '\\'
      OR source_event_id ILIKE $${b + 3} ESCAPE '\\' OR path ILIKE $${b + 4} ESCAPE '\\'
      OR parser ILIKE $${b + 5} ESCAPE '\\' OR parse_status ILIKE $${b + 6} ESCAPE '\\'
      OR metadata ILIKE $${b + 7} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM test_cases WHERE test_cases.report_id = test_reports.id
                 AND (test_cases.name ILIKE $${b + 8} ESCAPE '\\' OR test_cases.classname ILIKE $${b + 8} ESCAPE '\\'
                      OR test_cases.file ILIKE $${b + 8} ESCAPE '\\' OR test_cases.status ILIKE $${b + 8} ESCAPE '\\')))`);
  }
  return {
    where: conds.length ? `WHERE ${conds.join(" AND ")}` : "",
    params,
  };
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function clampInt(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), max);
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
