/**
 * @hasna/logs — LocalStore (on-box SQLite transport).
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * The ONE place in the app allowed to call `getDb()`. Every data-plane
 * operation the CLI/MCP/SDK need is implemented here by delegating to the
 * `src/lib/*` primitives against the local SQLite database. Callers hold the
 * {@link Store} interface (or, for on-box maintenance/compute commands, a
 * concrete {@link LocalStore} obtained via `requireLocalStore`) and never see
 * the db handle — that is the split-brain boundary this module enforces.
 */
import { backupLogsDb, getDb } from "../db/index.ts";
import {
  type AlertRule,
  createAlertRule,
  deleteAlertRule,
  listAlertRules,
} from "../lib/alerts.ts";
import {
  type CommandRunOptions,
  type CommandRunResult,
  LocalRunSink,
  runCapturedCommand,
} from "../lib/command-runner.ts";
import { type CompareResult, compare } from "../lib/compare.ts";
import { countLogs } from "../lib/count.ts";
import {
  type DiagnoseInclude,
  type DiagnosisResult,
  diagnose,
} from "../lib/diagnose.ts";
import {
  type EventStoreVerification,
  type RebuildEventStoreIndexResult,
  type RepairEventStoreSegmentsResult,
  rebuildEventStoreIndex,
  repairEventStoreSegments,
  verifyEventStore,
} from "../lib/event-store.ts";
import {
  type CliEventWatchFilter,
  type McpEventWatchArgs,
  type McpEventWatchResult,
  type WatchEventRow,
  latestMatchingEventRowid,
  queryWatchEventRows,
  rowidForEventId,
  watchEventsForMcp,
} from "../lib/event-watch.ts";
import {
  type EventCatalogEntry,
  type EventCatalogQuery,
  exportEventsToJson,
  getEvent,
  searchEvents,
} from "../lib/events.ts";
import { type HealthResult, getHealth } from "../lib/health.ts";
import { detectRuntimeIdentity } from "../lib/identity.ts";
import { ingestLog } from "../lib/ingest.ts";
import { type Issue, listIssues, updateIssueStatus } from "../lib/issues.ts";
import { createJob, getJob, listJobs } from "../lib/jobs.ts";
import { getLatestSnapshot, getPerfTrend } from "../lib/perf.ts";
import {
  createPage,
  createProject,
  getProject,
  listPages,
  listProjects,
  resolveProjectId,
} from "../lib/projects.ts";
import {
  getLogContext,
  getLogContextFromId,
  searchLogs,
  tailLogs,
} from "../lib/query.ts";
import { runJob } from "../lib/scheduler.ts";
import {
  type SessionContext,
  getSessionContext,
} from "../lib/session-context.ts";
import {
  type FollowStructuredJsonLinesOptions,
  type FollowStructuredJsonLinesResult,
  followStructuredJsonLines,
} from "../lib/structured-log-follow.ts";
import {
  type StructuredLogOptions,
  ingestStructuredJsonLines,
  validateStructuredLogReferences,
} from "../lib/structured-logs.ts";
import { summarizeLogs } from "../lib/summarize.ts";
import {
  type TestReportEntry,
  type TestReportQuery,
  getTestReport,
  searchTestReports,
} from "../lib/test-reports.ts";
import {
  type UniversalEventIngestResult,
  type UniversalEventInput,
  ingestUniversalEvent,
  validateUniversalEventInput,
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

/** SQLite-backed {@link Store}. Sole owner of the local database handle. */
export class LocalStore implements Store {
  async listLogs(query: LogQuery): Promise<LogRow[]> {
    return searchLogs(getDb(), query);
  }

  async tailLogs(projectId: string | undefined, n: number): Promise<LogRow[]> {
    return tailLogs(getDb(), projectId, n);
  }

  async getLog(id: string): Promise<LogRow | null> {
    const row = getDb()
      .prepare("SELECT * FROM logs WHERE id = ?")
      .get(id) as LogRow | null;
    return row ?? null;
  }

  async getLogContext(traceId: string): Promise<LogRow[]> {
    return getLogContext(getDb(), traceId);
  }

  async ingestLog(entry: LogEntry): Promise<LogRow> {
    return ingestLog(getDb(), entry);
  }

  async deleteLog(id: string): Promise<boolean> {
    const res = getDb().run("DELETE FROM logs WHERE id = ?", [id]);
    return (res.changes ?? 0) > 0;
  }

  async countLogs(input: CountLogsInput) {
    return countLogs(getDb(), input);
  }

  async summarize(
    projectId?: string,
    since?: string,
    until?: string,
  ): Promise<LogSummary[]> {
    return summarizeLogs(getDb(), projectId, since, until);
  }

  async health(): Promise<HealthResult> {
    return getHealth(getDb());
  }

  async listEvents(query: EventCatalogQuery): Promise<EventCatalogEntry[]> {
    return searchEvents(getDb(), query);
  }

  async getEvent(
    eventId: string,
    includeRaw: boolean,
  ): Promise<EventCatalogEntry | null> {
    return getEvent(getDb(), eventId, includeRaw);
  }

  async listTestReports(query: TestReportQuery): Promise<TestReportEntry[]> {
    return searchTestReports(getDb(), query);
  }

  async getTestReport(
    reportId: string,
    includeCases: boolean,
  ): Promise<TestReportEntry | null> {
    return getTestReport(getDb(), reportId, includeCases);
  }

  async listProjects(): Promise<Project[]> {
    return listProjects(getDb());
  }

  async getProject(id: string): Promise<Project | null> {
    return getProject(getDb(), id);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return createProject(getDb(), input);
  }

  async resolveProjectId(
    nameOrId: string | undefined,
  ): Promise<string | undefined> {
    if (!nameOrId) return undefined;
    return resolveProjectId(getDb(), nameOrId) ?? nameOrId;
  }

  async listPages(projectId: string): Promise<Page[]> {
    return listPages(getDb(), projectId);
  }

  async createPage(input: CreatePageInput): Promise<Page> {
    return createPage(getDb(), input);
  }

  async listJobs(projectId?: string): Promise<ScanJob[]> {
    return listJobs(getDb(), projectId);
  }

  async createJob(input: CreateJobInput): Promise<ScanJob> {
    return createJob(getDb(), input);
  }

  // ── local-only maintenance / compute operations ─────────
  // These have no cloud data model and run only against the on-box SQLite /
  // filesystem. They live on the concrete LocalStore (not the Store interface),
  // reached via `requireLocalStore()`, so `getDb()` stays confined to this file.

  /** Resolve name-or-id to an id that actually exists (else null). */
  resolveExistingProjectId(nameOrId: string | undefined): string | null {
    const db = getDb();
    const resolved = resolveProjectId(db, nameOrId);
    if (!resolved) return null;
    const row = db
      .prepare("SELECT id FROM projects WHERE id = ?")
      .get(resolved) as { id: string } | null;
    return row?.id ?? null;
  }

  async importStructuredLogs(
    input: string,
    options: StructuredLogOptions,
    source: string,
  ): Promise<ImportStructuredLogsResult> {
    const rows = ingestStructuredJsonLines(getDb(), input, options, source);
    return { inserted: rows.length, ids: rows.map((row) => row.id) };
  }

  followStructuredLogs(
    file: string,
    options: FollowStructuredJsonLinesOptions,
  ): Promise<FollowStructuredJsonLinesResult> {
    const db = getDb();
    return followStructuredJsonLines(
      (entry) => {
        validateStructuredLogReferences(db, [entry]);
        return ingestLog(db, entry);
      },
      file,
      options,
    );
  }

  runCapturedCommand(
    command: string[],
    options: CommandRunOptions,
  ): Promise<CommandRunResult> {
    return runCapturedCommand(new LocalRunSink(getDb()), command, options);
  }

  verifyEventStore(): EventStoreVerification {
    return verifyEventStore(getDb());
  }

  /**
   * Back up the on-disk database before a destructive maintenance op. Returns
   * the backup path, or `null` when there is nothing to snapshot.
   */
  backupDatabase(): string | null {
    return backupLogsDb();
  }

  rebuildEventStoreIndex(): RebuildEventStoreIndexResult {
    return rebuildEventStoreIndex(getDb());
  }

  repairEventStoreSegments(options: {
    apply?: boolean;
  }): RepairEventStoreSegmentsResult {
    return repairEventStoreSegments(getDb(), options);
  }

  /**
   * Ingest a raw-first universal event, optionally auto-detecting runtime
   * identity (machine/repo/app) when the caller did not supply one.
   */
  async pushEvent(
    input: UniversalEventInput,
    options: PushEventOptions = {},
  ): Promise<UniversalEventIngestResult> {
    const db = getDb();
    validateUniversalEventInput(input);
    if (options.detectIdentity) {
      const identity = detectRuntimeIdentity(db, process.cwd(), {
        project_id: this.resolveExistingProjectId(options.projectNameOrId),
        environment: options.environment,
      });
      input.machine_id = identity.machine_id;
      input.repo_id = identity.repo_id ?? undefined;
      input.app_id = identity.app_id ?? undefined;
      input.environment = options.environment ?? identity.environment;
    }
    return ingestUniversalEvent(db, input);
  }

  /** Best-effort self-telemetry ingest (never throws to the caller path). */
  ingestUniversalEvent(input: UniversalEventInput): UniversalEventIngestResult {
    return ingestUniversalEvent(getDb(), input);
  }

  async exportEvents(
    query: EventCatalogQuery,
    writeLine: (line: string) => void,
  ): Promise<number> {
    return exportEventsToJson(getDb(), query, writeLine);
  }

  async diagnose(
    projectId: string,
    since?: string,
    include?: DiagnoseInclude[],
  ): Promise<DiagnosisResult> {
    return diagnose(getDb(), projectId, since, include);
  }

  async compareWindows(
    projectId: string,
    aSince: string,
    aUntil: string,
    bSince: string,
    bUntil: string,
  ): Promise<CompareResult> {
    return compare(getDb(), projectId, aSince, aUntil, bSince, bUntil);
  }

  sessionContext(sessionId: string): Promise<SessionContext> {
    return getSessionContext(getDb(), sessionId);
  }

  async getLogContextFromId(logId: string, window: number): Promise<LogRow[]> {
    return getLogContextFromId(getDb(), logId, window);
  }

  async latestPerfSnapshot(
    projectId: string,
    pageId?: string,
  ): Promise<PerformanceSnapshot | null> {
    return getLatestSnapshot(getDb(), projectId, pageId);
  }

  async perfTrend(
    projectId: string,
    pageId?: string,
    since?: string,
    limit?: number,
  ): Promise<PerformanceSnapshot[]> {
    return getPerfTrend(getDb(), projectId, pageId, since, limit);
  }

  async listIssues(
    projectId?: string,
    status?: string,
    limit?: number,
  ): Promise<Issue[]> {
    return listIssues(getDb(), projectId, status, limit);
  }

  async updateIssueStatus(
    id: string,
    status: "open" | "resolved" | "ignored",
  ): Promise<Issue | null> {
    return updateIssueStatus(getDb(), id, status);
  }

  async createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule> {
    return createAlertRule(getDb(), input);
  }

  async listAlertRules(projectId?: string): Promise<AlertRule[]> {
    return listAlertRules(getDb(), projectId);
  }

  async deleteAlertRule(id: string): Promise<void> {
    deleteAlertRule(getDb(), id);
  }

  async recordFeedback(
    message: string,
    email: string | null,
    category: string,
    version: string,
  ): Promise<void> {
    getDb().run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      [message, email, category, version],
    );
  }

  async getScanJob(id: string): Promise<ScanJob | null> {
    return getJob(getDb(), id);
  }

  runScanJob(jobId: string, projectId: string, pageId?: string): Promise<void> {
    return runJob(getDb(), jobId, projectId, pageId);
  }

  // ── event-catalog live-tail (CLI `watch --events`) ──────
  latestWatchEventRowid(filter: CliEventWatchFilter): number {
    return latestMatchingEventRowid(getDb(), filter);
  }

  watchEventRowidForId(eventId: string): number | null {
    return rowidForEventId(getDb(), eventId);
  }

  queryWatchEventRows(
    filter: CliEventWatchFilter,
    afterRowid: number,
    since: string | undefined,
    limit: number,
  ): WatchEventRow[] {
    return queryWatchEventRows(getDb(), filter, afterRowid, since, limit);
  }

  // ── event-catalog cursor watch (MCP `event_watch`) ──────
  watchEventsForMcp(args: McpEventWatchArgs): McpEventWatchResult {
    return watchEventsForMcp(getDb(), args);
  }

  // ── Store interface: hosted-parity cursor watch ─────────
  async watchEvents(args: McpEventWatchArgs): Promise<McpEventWatchResult> {
    return watchEventsForMcp(getDb(), args);
  }
}
