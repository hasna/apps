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
 * The cloud tier is, by design, a shared log sink: it persists `logs` and
 * `projects`. Local-only analytics subsystems (events catalog, test reports,
 * scan jobs, pages) have no cloud data model; ApiStore surfaces a clear error
 * for those rather than silently returning empty/wrong data (no silent drift).
 *
 * SAFETY: never logs, returns, or embeds the API key. The key lives only inside
 * the HTTP transport created by @hasna/contracts.
 */
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { LogCount } from "../lib/count.ts";
import type { EventCatalogEntry, EventCatalogQuery } from "../lib/events.ts";
import type { HealthResult } from "../lib/health.ts";
import type { TestReportEntry, TestReportQuery } from "../lib/test-reports.ts";
import type {
  LogEntry,
  LogLevel,
  LogQuery,
  LogRow,
  LogSummary,
  Page,
  Project,
  ScanJob,
} from "../types/index.ts";
import type {
  CountLogsInput,
  CreateJobInput,
  CreatePageInput,
  CreateProjectInput,
  Store,
  StoreMode,
} from "./types.ts";

/** Cloud resource paths served under `/v1`. */
const LOGS = "logs";
const PROJECTS = "projects";

/** Features with no cloud data model — local-only. */
function unsupported(mode: StoreMode, feature: string): never {
  throw new Error(
    `${feature} is a local-only feature and is not available in ${mode} mode. ` +
      `The cloud tier is a shared log sink (logs + projects). ` +
      `Run against the local store (unset HASNA_LOGS_API_URL/HASNA_LOGS_API_KEY) to use ${feature}.`,
  );
}

/** Normalize a cloud log record (metadata may be an object) into a LogRow. */
function toLogRow(record: Record<string, unknown>): LogRow {
  const meta = record.metadata;
  const metadata =
    meta == null ? null : typeof meta === "string" ? meta : JSON.stringify(meta);
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
    const res = await this.client.list<Record<string, unknown>>(LOGS, { query: q });
    const raw = res.raw as { logs?: unknown[] } | null;
    const arr = Array.isArray(raw?.logs) ? raw!.logs : res.items;
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
    const record = await this.client.create<Record<string, unknown>>(LOGS, body);
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
    return this.client.transport.request<LogCount>("GET", `/${LOGS}/count`, undefined, {
      query,
    });
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
    const arr = Array.isArray(raw?.projects) ? raw!.projects : res.items;
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

  // ── local-only analytics (no cloud data model) ──────────

  async listEvents(_query: EventCatalogQuery): Promise<EventCatalogEntry[]> {
    return unsupported(this.mode, "the events catalog");
  }

  async getEvent(): Promise<EventCatalogEntry | null> {
    return unsupported(this.mode, "the events catalog");
  }

  async listTestReports(_query: TestReportQuery): Promise<TestReportEntry[]> {
    return unsupported(this.mode, "test reports");
  }

  async getTestReport(): Promise<TestReportEntry | null> {
    return unsupported(this.mode, "test reports");
  }

  async listPages(_projectId: string): Promise<Page[]> {
    return unsupported(this.mode, "pages");
  }

  async createPage(_input: CreatePageInput): Promise<Page> {
    return unsupported(this.mode, "pages");
  }

  async listJobs(_projectId?: string): Promise<ScanJob[]> {
    return unsupported(this.mode, "scan jobs");
  }

  async createJob(_input: CreateJobInput): Promise<ScanJob> {
    return unsupported(this.mode, "scan jobs");
  }
}
