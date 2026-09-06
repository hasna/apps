/**
 * @hasna/logs — ApiStore (HTTP /v1 + bearer-key transport).
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * The transport behind the hosted API: identical client code for every hosted
 * deployment; only the resolved URL/key differ (that distinction is server-side
 * tenancy, never a client branch). Every call goes to the app's configured
 * hosted HTTP API (the authority resolved by @hasna/contracts — keychain item,
 * credential file, or `HASNA_LOGS_API_URL`, with the fleet gateway
 * `https://api.hasna.com/logs` as the default) with the bearer key managed
 * inside the @hasna/contracts transport, refreshed per request.
 *
 * The hosted tier is a first-class shared backend: it persists and serves the
 * full data plane over `/v1` — logs, projects, pages, scan jobs, the events
 * catalog, test reports, performance snapshots, issues, alert rules, feedback,
 * and the diagnose/compare analytics. Every {@link Store} method routes here,
 * giving parity with the local SQLite store. The ONE thing the hosted tier
 * cannot serve is the raw event envelope body, which lives in local
 * append-only segment files (`raw` comes back null).
 *
 * SAFETY: never logs, returns, or embeds the API key. The key lives only inside
 * the HTTP transport created by @hasna/contracts.
 */
import type { AlertRule } from "../lib/alerts.ts";
import {
  ApiRunSink,
  type CommandRunOptions,
  type CommandRunResult,
  runCapturedCommand,
} from "../lib/command-runner.ts";
import type { CompareResult } from "../lib/compare.ts";
import type { LogCount } from "../lib/count.ts";
import type { DiagnoseInclude, DiagnosisResult } from "../lib/diagnose.ts";
import type { EventCatalogEntry, EventCatalogQuery } from "../lib/events.ts";
import {
  type McpEventWatchArgs,
  type McpEventWatchResult,
  clampMcpWatchLimit,
  matchesEventService,
} from "../lib/event-watch.ts";
import type { HealthResult } from "../lib/health.ts";
import { computeRuntimeIdentity } from "../lib/identity.ts";
import {
  type ScanContext,
  type ScanResult,
  scanPageWithContext,
} from "../lib/scanner.ts";
import type { Issue } from "../lib/issues.ts";
import type { SessionContext } from "../lib/session-context.ts";
import {
  type FollowStructuredJsonLinesOptions,
  type FollowStructuredJsonLinesResult,
  followStructuredJsonLines,
} from "../lib/structured-log-follow.ts";
import {
  type StructuredLogOptions,
  parseStructuredJsonLines,
} from "../lib/structured-logs.ts";
import type { TestReportEntry, TestReportQuery } from "../lib/test-reports.ts";
import type {
  UniversalEventIngestResult,
  UniversalEventInput,
} from "../lib/universal-ingest.ts";
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
  ScanRun,
} from "../types/index.ts";
import type {
  CountLogsInput,
  CreateAlertRuleInput,
  CreateJobInput,
  CreatePageInput,
  CreateProjectInput,
  ImportStructuredLogsResult,
  PushEventOptions,
  Store,
} from "./types.ts";
import type { LogsStorageClientLike } from "./client-types.ts";

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

/** Drop null/undefined entries so absent optionals are omitted, not sent as null. */
function compact(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== null) out[key] = item;
  }
  return out;
}

/** Scan executor signature, injectable for tests (browser-free). */
export type ApiRunScan = (
  ctx: ScanContext,
  projectId: string,
  pageId: string,
  urlOverride?: string,
) => Promise<ScanResult>;

export interface ApiStoreOptions {
  /**
   * Scan executor used by {@link ApiStore.runScanJob}. Defaults to the shared
   * `scanPageWithContext` (Playwright runs on this machine on both tiers);
   * tests inject a browser-free substitute.
   */
  runScan?: ApiRunScan;
}

/** HTTP-backed {@link Store} for the hosted API. */
export class ApiStore implements Store {
  private readonly client: LogsStorageClientLike;
  private readonly scanExecutor: ApiRunScan;

  constructor(
    client: LogsStorageClientLike,
    options: ApiStoreOptions = {},
  ) {
    this.client = client;
    this.scanExecutor = options.runScan ?? scanPageWithContext;
  }

  /** `<origin>/v1` base URL the client targets (never includes the key). */
  get baseUrl(): string {
    return this.client.baseUrl;
  }

  // ── logs ────────────────────────────────────────────────

  async listLogs(query: LogQuery): Promise<LogRow[]> {
    const q: Record<string, string | number | undefined> = {};
    if (query.project_id) q.project_id = query.project_id;
    if (query.page_id) q.page_id = query.page_id;
    if (query.service) q.service = query.service;
    if (query.trace_id) q.trace_id = query.trace_id;
    if (query.text) q.q = query.text;
    if (query.since) q.since = query.since;
    if (query.until) q.until = query.until;
    if (query.limit !== undefined) q.limit = query.limit;
    if (query.offset !== undefined) q.offset = query.offset;
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
    // Forward the FULL entry so cloud rows keep their run/process/identity
    // linkage (the server's /api/logs accepts the complete LogEntry). The
    // narrower field set here previously dropped machine/repo/app/process/run,
    // orphaning `logs run` output from its process on a flipped machine. Nullish
    // optionals are OMITTED (not sent as null): the server's ingest validator
    // rejects null for typed optional fields like `source`/`privacy`/`metadata`.
    const body = compact({
      id: entry.id,
      level: entry.level,
      message: entry.message,
      source_event_id: entry.source_event_id,
      project_id: entry.project_id,
      page_id: entry.page_id,
      source: entry.source,
      service: entry.service,
      privacy: entry.privacy,
      machine_id: entry.machine_id,
      repo_id: entry.repo_id,
      app_id: entry.app_id,
      process_id: entry.process_id,
      run_id: entry.run_id,
      trace_id: entry.trace_id,
      span_id: entry.span_id,
      parent_span_id: entry.parent_span_id,
      session_id: entry.session_id,
      release_id: entry.release_id,
      environment: entry.environment,
      agent: entry.agent,
      url: entry.url,
      stack_trace: entry.stack_trace,
      metadata: entry.metadata,
      timestamp: entry.timestamp,
    });
    const record = await this.client.create<Record<string, unknown>>(
      LOGS,
      body,
    );
    return toLogRow(record);
  }

  async importStructuredLogs(
    input: string,
    options: StructuredLogOptions,
    source: string,
  ): Promise<ImportStructuredLogsResult> {
    const entries = parseStructuredJsonLines(input, options, source);
    const ids: string[] = [];
    for (const entry of entries) {
      const row = await this.ingestLog(entry);
      ids.push(row.id);
    }
    return { inserted: ids.length, ids };
  }

  followStructuredLogs(
    file: string,
    options: FollowStructuredJsonLinesOptions,
  ): Promise<FollowStructuredJsonLinesResult> {
    return followStructuredJsonLines(
      (entry) => this.ingestLog(entry),
      file,
      options,
    );
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
    // Raw event bodies live in local segment files; the hosted tier has none, so
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

  async watchEvents(args: McpEventWatchArgs): Promise<McpEventWatchResult> {
    const limit = clampMcpWatchLimit(args.limit);
    const query: EventCatalogQuery = {
      event_type: args.event_type,
      source: args.source,
      severity: args.severity,
      project_id: args.project_id,
      machine_id: args.machine_id,
      repo_id: args.repo_id,
      app_id: args.app_id,
      process_id: args.process_id,
      run_id: args.run_id,
      trace_id: args.trace_id,
      session_id: args.session_id,
      environment: args.environment,
      since: args.since,
      limit: limit + 1,
      max_limit: 1_000,
      exclude_mcp_tool_telemetry: args.include_internal !== true,
    };

    // No cursor and not from_start: report the latest cursor, emit nothing —
    // the same "poll from latest" contract the local rowid cursor starts with.
    if (!args.last_event_id && args.from_start !== true) {
      const latest = await this.listEvents({ ...query, limit: 1 });
      return {
        events: [],
        cursor: latest[0]?.event_id ?? null,
        has_more: false,
        overflow: null,
      };
    }

    let anchor: EventCatalogEntry | null = null;
    if (args.last_event_id) {
      anchor = await this.getEvent(args.last_event_id, false).catch((error) => {
        // A missing anchor is an overflow (never replay history), not a crash.
        if (isNotFoundError(error)) return null;
        throw error;
      });
      if (!anchor) {
        const latest = await this.listEvents({ ...query, limit: 1 });
        return {
          events: [],
          cursor: latest[0]?.event_id ?? null,
          has_more: false,
          overflow: {
            reason: "last_event_id_unknown",
            last_event_id: args.last_event_id,
          },
        };
      }
      query.after_time = anchor.event_time;
      query.after_id = anchor.event_id;
    }
    // Ascending tail: events arrive oldest-first after the cursor (the hosted
    // counterpart of the local rowid-ordered query).
    query.order = "asc";

    let events = await this.listEvents(query);
    // `service` lives in metadata/message on both tiers (the hosted tier has no
    // service predicate on the event window), so the filter runs client-side.
    // Page the hosted stream (after_time/after_id cursors) until `limit + 1`
    // matching events are collected or the stream is exhausted — otherwise
    // matches beyond the first window are silently truncated and has_more is
    // computed over the UNFILTERED window. A safety bound never reports a
    // silent false: on exhaustion it returns has_more=true with the last
    // processed cursor so the caller continues instead of stopping early.
    const service = args.service;
    let truncated = false;
    let lastProcessedEventId: string | null = null;
    if (service) {
      const collected: EventCatalogEntry[] = [];
      let page = events;
      let collectedMatches = 0;
      let anchor: { after_time: string; after_id: string } | null = null;
      let guard = 0;
      const PAGING_SAFETY_BOUND = 500;
      while (collectedMatches <= limit && !truncated) {
        const pageLast = page.at(-1);
        if (pageLast) lastProcessedEventId = pageLast.event_id;
        for (const entry of page) {
          if (matchesEventService(entry, service)) {
            collected.push(entry);
            collectedMatches += 1;
          }
        }
        if (collectedMatches > limit || page.length < (query.limit ?? 0)) break;
        if (!pageLast) break;
        const next = {
          after_time: pageLast.event_time,
          after_id: pageLast.event_id,
        };
        if (
          anchor &&
          next.after_time === anchor.after_time &&
          next.after_id === anchor.after_id
        ) {
          // Non-advancing cursor: the stream cannot progress past this anchor.
          break;
        }
        anchor = next;
        query.after_time = next.after_time;
        query.after_id = next.after_id;
        guard += 1;
        if (guard >= PAGING_SAFETY_BOUND) {
          // Safety bound reached with matches still possibly beyond the
          // window: report has_more=true with the last processed cursor so
          // the caller continues from here — never a silent false.
          truncated = true;
          break;
        }
        page = await this.listEvents(query);
      }
      events = collected;
    }

    const hasMore = events.length > limit || truncated;
    const visible = events.slice(0, limit);
    const last = visible.at(-1);
    return {
      events: visible,
      cursor:
        last?.event_id ??
        (truncated
          ? (lastProcessedEventId ?? args.last_event_id ?? null)
          : (args.last_event_id ?? null)),
      has_more: hasMore,
      overflow: null,
    };
  }

  async pushEvent(
    input: UniversalEventInput,
    options: PushEventOptions = {},
  ): Promise<UniversalEventIngestResult> {
    const enriched: UniversalEventInput = { ...input };
    // Identity auto-detect is a pure client-side computation in api mode: the
    // deterministic machine/repo/app IDs travel on the event and the shared
    // server registers/indexes them (there is no on-box catalog to upsert).
    const hasExplicitIdentity = Boolean(
      input.machine_id || input.repo_id || input.app_id,
    );
    if (options.detectIdentity && !hasExplicitIdentity) {
      const identity = computeRuntimeIdentity(process.cwd(), {
        project_id: input.project_id ?? null,
        environment: options.environment ?? input.environment,
      });
      enriched.machine_id = identity.machine_id;
      enriched.repo_id = identity.repo_id ?? undefined;
      enriched.app_id = identity.app_id ?? undefined;
      enriched.environment = options.environment ?? identity.environment;
    }
    // POST as a single-item batch: the server's batch path returns
    // `{ inserted, events }` (201), giving us the inserted flag + stored event
    // without depending on the response status code.
    const res = await this.client.transport.request<{
      inserted?: number;
      events?: EventCatalogEntry[];
    }>("POST", "/events", { events: [enriched] });
    const event = res?.events?.[0];
    if (!event) {
      throw new Error("event ingest returned no event record");
    }
    return { inserted: (res?.inserted ?? 0) > 0, event };
  }

  // ── subprocess capture (`logs run`) ─────────────────────

  runCapturedCommand(
    command: string[],
    options: CommandRunOptions,
  ): Promise<CommandRunResult> {
    return runCapturedCommand(new ApiRunSink(this), command, options);
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

  async getScanJob(id: string): Promise<ScanJob | null> {
    // A missing job maps to `null` (the "job not found" the local tier
    // reports), not a thrown 404.
    try {
      return await this.client.get<ScanJob>("jobs", id);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  /**
   * Run an immediate headless scan for a job on the hosted path.
   *
   * Execution mirrors the local tier: the browser runs on THIS machine (the
   * transport requires client-side execution — the same reason `logs run`
   * captures subprocess telemetry locally), while every result is delivered
   * through the hosted data plane: collected logs via POST /v1/logs, a perf
   * snapshot via POST /v1/perf/snapshot, a scan-run record via
   * /v1/jobs/:id/runs, page last_scanned_at via PATCH /v1/pages/:id, and
   * job last_run_at via PUT /v1/jobs/:id.
   */
  async runScanJob(
    jobId: string,
    projectId: string,
    pageId?: string,
  ): Promise<void> {
    const pages = pageId
      ? [{ id: pageId }]
      : await this.listPages(projectId);

    await Promise.all(
      pages.map(async (page) => {
        const run = await this.createScanRun(jobId, page.id);
        try {
          const result = await this.scanExecutor(
            this.buildScanContext(),
            projectId,
            page.id,
          );
          await this.finishScanRun(jobId, run.id, {
            status: "completed",
            logs_collected: result.logsCollected,
            errors_found: result.errorsFound,
            perf_score: result.perfScore ?? undefined,
          });
        } catch (err) {
          await this.finishScanRun(jobId, run.id, {
            status: "failed",
            logs_collected: 0,
            errors_found: 0,
          });
          // Local parity: a failed page scan is recorded, not thrown.
          console.error(`Scan failed for page ${page.id}:`, err);
        }
      }),
    );

    await this.updateJobLastRun(jobId);
  }

  /** Hosted data-plane bindings for the shared headless scan execution. */
  private buildScanContext(): ScanContext {
    return {
      getPage: async (id) => this.client.get<Page>("pages", id),
      // Page auth (cookie/basic/bearer) is stored only on the local tier;
      // the hosted tier has no page-auth store, so scans run unauthenticated.
      getPageAuth: async () => null,
      ingest: async (entries) => {
        for (const entry of entries) await this.ingestLog(entry);
      },
      touchPage: async (id) => {
        await this.client.transport.request(
          "PATCH",
          `/pages/${encodeURIComponent(id)}`,
          { last_scanned_at: new Date().toISOString() },
        );
      },
      savePerfSnapshot: async (snapshot) => {
        await this.client.transport.request(
          "POST",
          "/perf/snapshot",
          snapshot,
        );
      },
    };
  }

  private async createScanRun(
    jobId: string,
    pageId: string,
  ): Promise<ScanRun> {
    return this.client.transport.request<ScanRun>(
      "POST",
      `/jobs/${encodeURIComponent(jobId)}/runs`,
      { page_id: pageId },
    );
  }

  private async finishScanRun(
    jobId: string,
    runId: string,
    data: {
      status: "completed" | "failed";
      logs_collected: number;
      errors_found: number;
      perf_score?: number;
    },
  ): Promise<void> {
    await this.client.transport.request(
      "PATCH",
      `/jobs/${encodeURIComponent(jobId)}/runs/${encodeURIComponent(runId)}`,
      data,
    );
  }

  private async updateJobLastRun(jobId: string): Promise<void> {
    await this.client.transport.request(
      "PUT",
      `/jobs/${encodeURIComponent(jobId)}`,
      { last_run_at: new Date().toISOString() },
    );
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

/**
 * Shape match, never instanceof: `@hasna/contracts` builds its `./client` and
 * `./client/storage` bundles as separate module instances (each carrying its
 * own copy of the error class — the projects seam documents the same rule),
 * so a cross-subpath `instanceof HasnaHttpError` is false even for the same
 * published version. The error CLASS sets `name` in its constructor, which is
 * stable across the copies; match on that and on the status shape.
 */
function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "HasnaHttpError" &&
    (error as { status?: unknown }).status === 404
  );
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
  assign("after_time", query.after_time);
  assign("after_id", query.after_id);
  assign("order", query.order);
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
