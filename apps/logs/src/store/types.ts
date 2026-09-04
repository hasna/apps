/**
 * @hasna/logs — unified Store abstraction (data-plane contract).
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE storage interface, two transports behind it:
 *   - LocalStore  (on-box SQLite; the sole owner of getDb)
 *   - ApiStore    (HTTP /v1 + bearer key — the hosted API)
 *
 * EVERY CLI command, MCP tool, and SDK method that reads or writes log data must
 * route through this interface — never touch `getDb()` / raw `fetch` directly.
 * That is the split-brain bug this module eliminates: a single resolver picks
 * the transport from the environment, and callers never branch on mode again.
 */
import type { AlertRule } from "../lib/alerts.ts";
import type {
  CommandRunOptions,
  CommandRunResult,
} from "../lib/command-runner.ts";
import type { CompareResult } from "../lib/compare.ts";
import type { LogCount } from "../lib/count.ts";
import type { DiagnoseInclude, DiagnosisResult } from "../lib/diagnose.ts";
import type { EventCatalogEntry, EventCatalogQuery } from "../lib/events.ts";
import type {
  McpEventWatchArgs,
  McpEventWatchResult,
} from "../lib/event-watch.ts";
import type { HealthResult } from "../lib/health.ts";
import type { Issue } from "../lib/issues.ts";
import type { SessionContext } from "../lib/session-context.ts";
import type {
  FollowStructuredJsonLinesOptions,
  FollowStructuredJsonLinesResult,
} from "../lib/structured-log-follow.ts";
import type { StructuredLogOptions } from "../lib/structured-logs.ts";
import type { TestReportEntry, TestReportQuery } from "../lib/test-reports.ts";
import type {
  UniversalEventIngestResult,
  UniversalEventInput,
} from "../lib/universal-ingest.ts";
import type {
  LogEntry,
  LogQuery,
  LogRow,
  LogSummary,
  Page,
  PerformanceSnapshot,
  Project,
  ScanJob,
} from "../types/index.ts";

export interface CreateProjectInput {
  name: string;
  github_repo?: string;
  base_url?: string;
  description?: string;
}

export interface CreatePageInput {
  project_id: string;
  url: string;
  path?: string;
  name?: string;
}

export interface CreateJobInput {
  project_id: string;
  schedule: string;
  page_id?: string;
}

export interface CountLogsInput {
  project_id?: string;
  service?: string;
  level?: string;
  since?: string;
  until?: string;
  group_by?: "level" | "service";
}

/** Input for {@link LocalStore.createAlertRule}. */
export interface CreateAlertRuleInput {
  project_id: string;
  name: string;
  service?: string;
  level?: string;
  threshold_count?: number;
  window_seconds?: number;
  action?: "webhook" | "log";
  webhook_url?: string;
}

/** Options for {@link Store.pushEvent} identity auto-detection. */
export interface PushEventOptions {
  /** Auto-detect runtime identity (machine/repo/app) when none was supplied. */
  detectIdentity?: boolean;
  /** Project name-or-id used to scope identity detection. */
  projectNameOrId?: string;
  /** Explicit environment override. */
  environment?: string;
}

/** Back-compat alias. @deprecated use {@link PushEventOptions}. */
export type PushUniversalEventOptions = PushEventOptions;

/** Result of importing structured JSONL log records through a {@link Store}. */
export interface ImportStructuredLogsResult {
  inserted: number;
  ids: string[];
}

/**
 * The @hasna/logs data-plane. Local and API transports implement it identically,
 * so callers hold `Store` and never know (or care) which tier is live.
 */
export interface Store {
  // ── logs ────────────────────────────────────────────────
  listLogs(query: LogQuery): Promise<LogRow[]>;
  tailLogs(projectId: string | undefined, n: number): Promise<LogRow[]>;
  getLog(id: string): Promise<LogRow | null>;
  getLogContext(traceId: string): Promise<LogRow[]>;
  /** Trace context plus an optional ±window of neighbouring logs by time. */
  getLogContextFromId(logId: string, window: number): Promise<LogRow[]>;
  ingestLog(entry: LogEntry): Promise<LogRow>;
  /** Import newline-delimited structured JSON log records. */
  importStructuredLogs(
    input: string,
    options: StructuredLogOptions,
    source: string,
  ): Promise<ImportStructuredLogsResult>;
  /** Tail a JSONL file, ingesting appended records through this transport. */
  followStructuredLogs(
    file: string,
    options: FollowStructuredJsonLinesOptions,
  ): Promise<FollowStructuredJsonLinesResult>;
  deleteLog(id: string): Promise<boolean>;
  countLogs(input: CountLogsInput): Promise<LogCount>;
  summarize(
    projectId?: string,
    since?: string,
    until?: string,
  ): Promise<LogSummary[]>;
  health(): Promise<HealthResult>;

  // ── events ──────────────────────────────────────────────
  listEvents(query: EventCatalogQuery): Promise<EventCatalogEntry[]>;
  getEvent(
    eventId: string,
    includeRaw: boolean,
  ): Promise<EventCatalogEntry | null>;
  /** Stream matching events as a JSON array via `writeLine`; returns the count. */
  exportEvents(
    query: EventCatalogQuery,
    writeLine: (line: string) => void,
  ): Promise<number>;
  /** Ingest one raw-first universal telemetry event. */
  pushEvent(
    input: UniversalEventInput,
    options?: PushEventOptions,
  ): Promise<UniversalEventIngestResult>;

  // ── subprocess capture (`logs run`) ─────────────────────
  /** Run a command and capture process/stdout/stderr telemetry. */
  runCapturedCommand(
    command: string[],
    options: CommandRunOptions,
  ): Promise<CommandRunResult>;

  // ── test reports ────────────────────────────────────────
  listTestReports(query: TestReportQuery): Promise<TestReportEntry[]>;
  getTestReport(
    reportId: string,
    includeCases: boolean,
  ): Promise<TestReportEntry | null>;

  // ── projects / pages / jobs ─────────────────────────────
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: CreateProjectInput): Promise<Project>;
  /** Resolve a name-or-id to a canonical project id (or the input when local-only). */
  resolveProjectId(nameOrId: string | undefined): Promise<string | undefined>;
  listPages(projectId: string): Promise<Page[]>;
  createPage(input: CreatePageInput): Promise<Page>;
  listJobs(projectId?: string): Promise<ScanJob[]>;
  createJob(input: CreateJobInput): Promise<ScanJob>;
  /** Fetch one scan job by id (hosted: GET /v1/jobs/:id). */
  getScanJob(id: string): Promise<ScanJob | null>;
  /**
   * Run an immediate headless scan for a job. The browser executes on the
   * machine running the CLI on BOTH tiers (the transport requires it); every
   * result — collected logs, perf snapshot, scan-run record, `last_run_at` —
   * is delivered through the live transport.
   */
  runScanJob(jobId: string, projectId: string, pageId?: string): Promise<void>;

  // ── event-catalog live-tail (`watch --events` / MCP `event_watch`) ──
  /**
   * Poll event-catalog records after a cursor. Identical semantics on both
   * tiers: anchored cursors, `from_start`, `last_event_id_unknown` overflow,
   * `has_more`, and the internal-telemetry exclusion.
   */
  watchEvents(args: McpEventWatchArgs): Promise<McpEventWatchResult>;

  // ── performance ─────────────────────────────────────────
  latestPerfSnapshot(
    projectId: string,
    pageId?: string,
  ): Promise<PerformanceSnapshot | null>;
  perfTrend(
    projectId: string,
    pageId?: string,
    since?: string,
    limit?: number,
  ): Promise<PerformanceSnapshot[]>;

  // ── issues ──────────────────────────────────────────────
  listIssues(
    projectId?: string,
    status?: string,
    limit?: number,
  ): Promise<Issue[]>;
  updateIssueStatus(
    id: string,
    status: "open" | "resolved" | "ignored",
  ): Promise<Issue | null>;

  // ── alert rules ─────────────────────────────────────────
  createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule>;
  listAlertRules(projectId?: string): Promise<AlertRule[]>;
  deleteAlertRule(id: string): Promise<void>;

  // ── feedback ────────────────────────────────────────────
  recordFeedback(
    message: string,
    email: string | null,
    category: string,
    version: string,
  ): Promise<void>;

  // ── diagnostics ─────────────────────────────────────────
  sessionContext(sessionId: string): Promise<SessionContext>;
  diagnose(
    projectId: string,
    since?: string,
    include?: DiagnoseInclude[],
  ): Promise<DiagnosisResult>;
  compareWindows(
    projectId: string,
    aSince: string,
    aUntil: string,
    bSince: string,
    bUntil: string,
  ): Promise<CompareResult>;
}
