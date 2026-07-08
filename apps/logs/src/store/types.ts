/**
 * @hasna/logs — unified Store abstraction (data-plane contract).
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE storage interface, two transports behind it:
 *   - LocalStore  (on-box SQLite; the sole owner of getDb)
 *   - ApiStore    (HTTP /v1 + bearer key; self_hosted AND cloud both use this)
 *
 * EVERY CLI command, MCP tool, and SDK method that reads or writes log data must
 * route through this interface — never touch `getDb()` / raw `fetch` directly.
 * That is the split-brain bug this module eliminates: a single resolver picks
 * the transport from the environment, and callers never branch on mode again.
 */
import type { LogCount } from "../lib/count.ts";
import type { EventCatalogEntry, EventCatalogQuery } from "../lib/events.ts";
import type { HealthResult } from "../lib/health.ts";
import type { TestReportEntry, TestReportQuery } from "../lib/test-reports.ts";
import type {
  LogEntry,
  LogQuery,
  LogRow,
  LogSummary,
  Page,
  Project,
  ScanJob,
} from "../types/index.ts";

/** Resolved storage tier. `self_hosted` and `cloud` both use {@link ApiStore}. */
export type StoreMode = "local" | "self_hosted" | "cloud";

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

/** Options for {@link LocalStore.pushUniversalEvent}. */
export interface PushUniversalEventOptions {
  /** Auto-detect runtime identity (machine/repo/app) when none was supplied. */
  detectIdentity?: boolean;
  /** Project name-or-id used to scope identity detection. */
  projectNameOrId?: string;
  /** Explicit environment override. */
  environment?: string;
}

/**
 * The @hasna/logs data-plane. Local and API transports implement it identically,
 * so callers hold `Store` and never know (or care) which tier is live.
 */
export interface Store {
  /** Resolved tier, for status/telemetry only — never gates behavior. */
  readonly mode: StoreMode;

  // ── logs ────────────────────────────────────────────────
  listLogs(query: LogQuery): Promise<LogRow[]>;
  tailLogs(projectId: string | undefined, n: number): Promise<LogRow[]>;
  getLog(id: string): Promise<LogRow | null>;
  getLogContext(traceId: string): Promise<LogRow[]>;
  ingestLog(entry: LogEntry): Promise<LogRow>;
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
}
