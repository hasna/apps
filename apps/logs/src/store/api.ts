/**
 * @hasna/logs — ApiStore (HTTP /v1 + bearer-key transport).
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * The transport used by BOTH `self_hosted` (our AWS) and `cloud` (SaaS) tiers —
 * identical client code; only the resolved URL/key differ (that distinction is
 * server-side tenancy, never a client branch). Every call goes to the app's
 * cloud HTTP API (`https://logs.hasna.xyz/v1/...`) with the bearer key managed
 * inside the @hasna/contracts transport.
 *
 * The cloud tier is a first-class shared backend: it persists and serves the
 * full data plane over `/v1` — logs, projects, pages, scan jobs, the events
 * catalog, test reports, performance snapshots, issues, alert rules, feedback,
 * and the diagnose/compare analytics. Every {@link Store} method routes here in
 * self_hosted/cloud mode, giving cloud parity with the local SQLite store. The
 * ONE thing the cloud tier cannot serve is the raw event envelope body, which
 * lives in local append-only segment files (`raw` comes back null in cloud).
 *
 * SAFETY: never logs, returns, or embeds the API key. The key lives only inside
 * the HTTP transport created by @hasna/contracts.
 */
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { AlertRule } from "../lib/alerts.ts";
import type { CompareResult } from "../lib/compare.ts";
import type { LogCount } from "../lib/count.ts";
import type { DiagnoseInclude, DiagnosisResult } from "../lib/diagnose.ts";
import type { EventCatalogEntry, EventCatalogQuery } from "../lib/events.ts";
import type { HealthResult } from "../lib/health.ts";
import type { Issue } from "../lib/issues.ts";
import type { SessionContext } from "../lib/session-context.ts";
import type { TestReportEntry, TestReportQuery } from "../lib/test-reports.ts";
import type {
  LogEntry,
  LogLevel,
  LogQuery,
  LogRow,
  LogSummary,
  Page,
  PerformanceSnapshot,
  Project,
  ScanJob,
} from "../types/index.ts";
import type {
  CountLogsInput,
  CreateAlertRuleInput,
  CreateJobInput,
  CreatePageInput,
  CreateProjectInput,
  Store,
  StoreMode,
} from "./types.ts";

/** Cloud resource paths served under `/v1`. */
const LOGS = "logs";
const PROJECTS = "projects";

/** Normalize a cloud log record (metadata may be an object) into a LogRow. */
function toLogRow(record: Record<string, unknown>): LogRow {
  const meta = record.metadata;
  const metadata =
    meta == null
      ? null
      : typeof meta === "string"
        ? meta
        : JSON.stringify(meta);
  return {
    id: String(record.id),
    timestamp: String(record.timestamp ?? ""),
    project_id: (record.project_id as string | null) ?? null,
    page_id: (record.page_id as string | null) ?? null,
    level: (record.level as LogLevel) ?? "info",
    source: (record.source as LogRow["source"]) ?? "sdk",
    service: (record.service as string | null) ?? null,
    message: String(record.message ?? ""),
    trace_id: (record.trace_id as string | null) ?? null,
    session_id: (record.session_id as string | null) ?? null,
    agent: (record.agent as string | null) ?? null,
    url: (record.url as string | null) ?? null,
    stack_trace: (record.stack_trace as string | null) ?? null,
    metadata,
  };
}

function toProject(record: Record<string, unknown>): Project {
  return {
    id: String(record.id),
    name: String(record.name ?? ""),
    github_repo: (record.github_repo as string | null) ?? null,
    base_url: (record.base_url as string | null) ?? null,
    description: (record.description as string | null) ?? null,
    github_description: (record.github_description as string | null) ?? null,
    github_branch: (record.github_branch as string | null) ?? null,
    github_sha: (record.github_sha as string | null) ?? null,
    last_synced_at: (record.last_synced_at as string | null) ?? null,
    created_at: String(record.created_at ?? ""),
  };
}

function levelsOf(level?: LogLevel | LogLevel[]): LogLevel[] {
  if (!level) return [];
  return Array.isArray(level) ? level : [level];
}

/** HTTP-backed {@link Store} for `self_hosted` and `cloud` tiers. */
export class ApiStore implements Store {
  readonly mode: StoreMode;
  private readonly client: HasnaStorageClient;

  constructor(client: HasnaStorageClient, mode: StoreMode = "self_hosted") {
    this.client = client;
    this.mode = mode;
  }

  /** `<origin>/v1` base URL the client targets (never includes the key). */
  get baseUrl(): string {
    return this.client.baseUrl;
  }

  // ── logs ────────────────────────────────────────────────

  async listLogs(query: LogQuery): Promise<LogRow[]> {
    const q: Record<string, string | number | undefined> = {};
    if (query.project_id) q.project_id = query.project_id;
    if (query.service) q.service = query.service;
    if (query.trace_id) q.trace_id = query.trace_id;
    if (query.text) q.q = query.text;
    if (query.limit !== undefined) q.limit = query.limit;
    const levels = levelsOf(query.level);
    if (levels.length === 1) q.level = levels[0];
    const res = await this.client.list<Record<string, unknown>>(LOGS, {
      query: q,
    });
    const raw = res.raw as { logs?: unknown[] } | null;
    const list = raw?.logs;
    const arr = Array.isArray(list) ? list : res.items;
    let rows = (arr as Record<string, unknown>[]).map(toLogRow);
    if (levels.length > 1) {
      const set = new Set(levels);
      rows = rows.filter((r) => set.has(r.level));
    }
    return rows;
  }

  async tailLogs(projectId: string | undefined, n: number): Promise<LogRow[]> {
    return this.listLogs({ project_id: projectId, limit: n });
  }

  async getLog(id: string): Promise<LogRow | null> {
    const record = await this.client.get<Record<string, unknown>>(LOGS, id);
    return record ? toLogRow(record) : null;
  }

  async getLogContext(traceId: string): Promise<LogRow[]> {
    const rows = await this.listLogs({ trace_id: traceId, limit: 1000 });
    // Local getLogContext returns oldest-first; mirror that ordering.
    return rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async ingestLog(entry: LogEntry): Promise<LogRow> {
    const body: Record<string, unknown> = {
      level: entry.level,
      message: entry.message,
      project_id: entry.project_id ?? null,
      source: entry.source ?? null,
      service: entry.service ?? null,
      trace_id: entry.trace_id ?? null,
      session_id: entry.session_id ?? null,
      agent: entry.agent ?? null,
      url: entry.url ?? null,
      stack_trace: entry.stack_trace ?? null,
      metadata: entry.metadata ?? null,
      timestamp: entry.timestamp ?? null,
    };
    const record = await this.client.create<Record<string, unknown>>(
      LOGS,
      body,
    );
    return toLogRow(record);
  }

  async deleteLog(id: string): Promise<boolean> {
    // /v1/logs/:id returns { deleted, id }; read the body via the transport.
    const res = await this.client.transport.request<{ deleted?: boolean }>(
      "DELETE",
      `/${LOGS}/${encodeURIComponent(id)}`,
    );
    return res?.deleted === true;
  }

  async countLogs(input: CountLogsInput): Promise<LogCount> {
    const query: Record<string, string | undefined> = {};
    if (input.project_id) query.project_id = input.project_id;
    if (input.service) query.service = input.service;
    if (input.level) query.level = input.level;
    if (input.since) query.since = input.since;
    if (input.until) query.until = input.until;
    if (input.group_by) query.group_by = input.group_by;
    return this.client.transport.request<LogCount>(
      "GET",
      `/${LOGS}/count`,
      undefined,
      {
        query,
      },
    );
  }

  async summarize(
    projectId?: string,
    since?: string,
    until?: string,
  ): Promise<LogSummary[]> {
    const query: Record<string, string | undefined> = {};
    if (projectId) query.project_id = projectId;
    if (since) query.since = since;
    if (until) query.until = until;
    const res = await this.client.transport.request<{ summary?: LogSummary[] }>(
      "GET",
      `/${LOGS}/summary`,
      undefined,
      { query },
    );
    return res?.summary ?? [];
  }

  async health(): Promise<HealthResult> {
    return this.client.transport.request<HealthResult>("GET", "/health");
  }

  // ── projects ────────────────────────────────────────────

  async listProjects(): Promise<Project[]> {
    const res = await this.client.list<Record<string, unknown>>(PROJECTS);
    const raw = res.raw as { projects?: unknown[] } | null;
    const list = raw?.projects;
    const arr = Array.isArray(list) ? list : res.items;
    return (arr as Record<string, unknown>[]).map(toProject);
  }

  async getProject(id: string): Promise<Project | null> {
    const record = await this.client.get<Record<string, unknown>>(PROJECTS, id);
    return record ? toProject(record) : null;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const record = await this.client.create<Record<string, unknown>>(PROJECTS, {
      name: input.name,
      github_repo: input.github_repo ?? null,
      base_url: input.base_url ?? null,
      description: input.description ?? null,
    });
    return toProject(record);
  }

  async resolveProjectId(
    nameOrId: string | undefined,
  ): Promise<string | undefined> {
    if (!nameOrId) return undefined;
    // Try direct id lookup first, then match by name against the project list.
    const byId = await this.getProject(nameOrId).catch(() => null);
    if (byId) return byId.id;
    const projects = await this.listProjects();
    const byName = projects.find((p) => p.name === nameOrId);
    return byName ? byName.id : nameOrId;
  }

  // ── log context ─────────────────────────────────────────

  async getLogContextFromId(logId: string, window: number): Promise<LogRow[]> {
    const res = await this.client.transport.request<{ logs?: unknown[] }>(
      "GET",
      `/${LOGS}/${encodeURIComponent(logId)}/context`,
      undefined,
      { query: { window } },
    );
    return (res?.logs ?? []).map((r) => toLogRow(r as Record<string, unknown>));
  }

  // ── events catalog ──────────────────────────────────────

  async listEvents(query: EventCatalogQuery): Promise<EventCatalogEntry[]> {
    const res = await this.client.transport.request<{
      events?: EventCatalogEntry[];
    }>("GET", "/events", undefined, { query: eventQueryParams(query) });
    return res?.events ?? [];
  }

  async getEvent(
    eventId: string,
    _includeRaw: boolean,
  ): Promise<EventCatalogEntry | null> {
    // Raw event bodies live in local segment files; the cloud tier has none, so
    // `raw` is always null here regardless of the includeRaw flag.
    const record = await this.client.get<EventCatalogEntry>("events", eventId);
    return record ?? null;
  }

  async exportEvents(
    query: EventCatalogQuery,
    writeLine: (line: string) => void,
  ): Promise<number> {
    const events = await this.listEvents({
      ...query,
      limit: query.limit ?? 100_000,
      max_limit: 100_000,
    });
    writeLine("[");
    events.forEach((event, i) => {
      writeLine((i > 0 ? "," : "") + JSON.stringify(event));
    });
    writeLine("]");
    return events.length;
  }

  // ── test reports ────────────────────────────────────────

  async listTestReports(query: TestReportQuery): Promise<TestReportEntry[]> {
    const res = await this.client.transport.request<{
      reports?: TestReportEntry[];
    }>("GET", "/test-reports", undefined, {
      query: testReportQueryParams(query),
    });
    return res?.reports ?? [];
  }

  async getTestReport(
    reportId: string,
    includeCases: boolean,
  ): Promise<TestReportEntry | null> {
    const record = await this.client.transport.request<TestReportEntry | null>(
      "GET",
      `/test-reports/${encodeURIComponent(reportId)}`,
      undefined,
      { query: { include_cases: includeCases ? "true" : "false" } },
    );
    return record ?? null;
  }

  // ── pages ───────────────────────────────────────────────

  async listPages(projectId: string): Promise<Page[]> {
    const res = await this.client.transport.request<{ pages?: Page[] }>(
      "GET",
      "/pages",
      undefined,
      { query: { project_id: projectId } },
    );
    return res?.pages ?? [];
  }

  async createPage(input: CreatePageInput): Promise<Page> {
    return this.client.create<Page>("pages", {
      project_id: input.project_id,
      url: input.url,
      path: input.path ?? null,
      name: input.name ?? null,
    });
  }

  // ── scan jobs ───────────────────────────────────────────

  async listJobs(projectId?: string): Promise<ScanJob[]> {
    const res = await this.client.transport.request<{ jobs?: ScanJob[] }>(
      "GET",
      "/jobs",
      undefined,
      { query: projectId ? { project_id: projectId } : {} },
    );
    return res?.jobs ?? [];
  }

  async createJob(input: CreateJobInput): Promise<ScanJob> {
    return this.client.create<ScanJob>("jobs", {
      project_id: input.project_id,
      schedule: input.schedule,
      page_id: input.page_id ?? null,
    });
  }

  // ── performance ─────────────────────────────────────────

  async latestPerfSnapshot(
    projectId: string,
    pageId?: string,
  ): Promise<PerformanceSnapshot | null> {
    const res = await this.client.transport.request<{
      snapshot?: PerformanceSnapshot | null;
    }>("GET", "/perf/latest", undefined, {
      query: { project_id: projectId, ...(pageId ? { page_id: pageId } : {}) },
    });
    return res?.snapshot ?? null;
  }

  async perfTrend(
    projectId: string,
    pageId?: string,
    since?: string,
    limit?: number,
  ): Promise<PerformanceSnapshot[]> {
    const res = await this.client.transport.request<{
      snapshots?: PerformanceSnapshot[];
    }>("GET", "/perf/trend", undefined, {
      query: {
        project_id: projectId,
        ...(pageId ? { page_id: pageId } : {}),
        ...(since ? { since } : {}),
        ...(limit !== undefined ? { limit } : {}),
      },
    });
    return res?.snapshots ?? [];
  }

  // ── issues ──────────────────────────────────────────────

  async listIssues(
    projectId?: string,
    status?: string,
    limit?: number,
  ): Promise<Issue[]> {
    const res = await this.client.transport.request<{ issues?: Issue[] }>(
      "GET",
      "/issues",
      undefined,
      {
        query: {
          ...(projectId ? { project_id: projectId } : {}),
          ...(status ? { status } : {}),
          ...(limit !== undefined ? { limit } : {}),
        },
      },
    );
    return res?.issues ?? [];
  }

  async updateIssueStatus(
    id: string,
    status: "open" | "resolved" | "ignored",
  ): Promise<Issue | null> {
    return this.client.transport
      .request<Issue>("PATCH", `/issues/${encodeURIComponent(id)}`, { status })
      .catch(() => null);
  }

  // ── alert rules ─────────────────────────────────────────

  async createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule> {
    return this.client.transport.request<AlertRule>(
      "POST",
      "/alert-rules",
      input,
    );
  }

  async listAlertRules(projectId?: string): Promise<AlertRule[]> {
    const res = await this.client.transport.request<{ rules?: AlertRule[] }>(
      "GET",
      "/alert-rules",
      undefined,
      { query: projectId ? { project_id: projectId } : {} },
    );
    return res?.rules ?? [];
  }

  async deleteAlertRule(id: string): Promise<void> {
    await this.client.transport.request(
      "DELETE",
      `/alert-rules/${encodeURIComponent(id)}`,
    );
  }

  // ── feedback ────────────────────────────────────────────

  async recordFeedback(
    message: string,
    email: string | null,
    category: string,
    version: string,
  ): Promise<void> {
    await this.client.transport.request("POST", "/feedback", {
      message,
      email,
      category,
      version,
    });
  }

  // ── session context ─────────────────────────────────────

  async sessionContext(sessionId: string): Promise<SessionContext> {
    const res = await this.client.transport.request<{
      session_id?: string;
      logs?: unknown[];
      session?: Record<string, unknown>;
      error?: string;
    }>("GET", `/sessions/${encodeURIComponent(sessionId)}/context`);
    return {
      session_id: res?.session_id ?? sessionId,
      logs: (res?.logs ?? []).map((r) =>
        toLogRow(r as Record<string, unknown>),
      ),
      ...(res?.session ? { session: res.session } : {}),
      ...(res?.error ? { error: res.error } : {}),
    };
  }

  // ── diagnose / compare ──────────────────────────────────

  async diagnose(
    projectId: string,
    since?: string,
    include?: DiagnoseInclude[],
  ): Promise<DiagnosisResult> {
    return this.client.transport.request<DiagnosisResult>(
      "GET",
      "/diagnose",
      undefined,
      {
        query: {
          project_id: projectId,
          ...(since ? { since } : {}),
          ...(include?.length ? { include: include.join(",") } : {}),
        },
      },
    );
  }

  async compareWindows(
    projectId: string,
    aSince: string,
    aUntil: string,
    bSince: string,
    bUntil: string,
  ): Promise<CompareResult> {
    return this.client.transport.request<CompareResult>(
      "GET",
      "/compare",
      undefined,
      {
        query: {
          project_id: projectId,
          a_since: aSince,
          a_until: aUntil,
          b_since: bSince,
          b_until: bUntil,
        },
      },
    );
  }
}

/** Serialize an {@link EventCatalogQuery} into flat query params (arrays joined). */
function eventQueryParams(
  query: EventCatalogQuery,
): Record<string, string | number> {
  const q: Record<string, string | number> = {};
  const join = (v: string | string[] | undefined) =>
    v === undefined ? undefined : Array.isArray(v) ? v.join(",") : v;
  const assign = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") q[key] = value;
  };
  assign("event_id", query.event_id);
  assign("event_type", join(query.event_type));
  assign("source", join(query.source));
  assign("severity", join(query.severity));
  assign("project_id", query.project_id);
  assign("page_id", query.page_id);
  assign("machine_id", query.machine_id);
  assign("repo_id", query.repo_id);
  assign("app_id", query.app_id);
  assign("process_id", query.process_id);
  assign("run_id", query.run_id);
  assign("trace_id", query.trace_id);
  assign("span_id", query.span_id);
  assign("session_id", query.session_id);
  assign("release_id", query.release_id);
  assign("environment", query.environment);
  assign("since", query.since);
  assign("until", query.until);
  assign("text", query.text);
  assign("limit", query.limit);
  assign("offset", query.offset);
  assign("max_limit", query.max_limit);
  if (query.exclude_mcp_tool_telemetry) q.exclude_mcp_tool_telemetry = "true";
  return q;
}

/** Serialize a {@link TestReportQuery} into flat query params. */
function testReportQueryParams(
  query: TestReportQuery,
): Record<string, string | number> {
  const q: Record<string, string | number> = {};
  const assign = (key: string, value: string | number | null | undefined) => {
    if (value !== undefined && value !== null && value !== "") q[key] = value;
  };
  assign("report_id", query.report_id);
  assign("event_id", query.event_id);
  assign("project_id", query.project_id);
  assign("machine_id", query.machine_id);
  assign("repo_id", query.repo_id);
  assign("app_id", query.app_id);
  assign("process_id", query.process_id);
  assign("run_id", query.run_id);
  assign("environment", query.environment);
  assign("source", query.source);
  assign("parser", query.parser);
  assign("parse_status", query.parse_status);
  assign("path", query.path);
  assign("case_status", query.case_status);
  assign("outcome", query.outcome);
  assign("min_failures", query.min_failures);
  assign("min_errors", query.min_errors);
  assign("min_skipped", query.min_skipped);
  assign("since", query.since);
  assign("until", query.until);
  assign("text", query.text);
  assign("limit", query.limit);
  assign("offset", query.offset);
  if (query.include_cases) q.include_cases = "true";
  return q;
}
