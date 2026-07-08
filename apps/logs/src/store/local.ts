/**
 * @hasna/logs — LocalStore (on-box SQLite transport).
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * The ONE place in the app allowed to call `getDb()`. Every data-plane
 * operation the CLI/MCP/SDK need is implemented here by delegating to the
 * `src/lib/*` primitives against the local SQLite database. Callers hold the
 * {@link Store} interface and never see the db handle.
 */
import { getDb } from "../db/index.ts";
import { countLogs } from "../lib/count.ts";
import {
  type EventCatalogEntry,
  type EventCatalogQuery,
  getEvent,
  searchEvents,
} from "../lib/events.ts";
import { getHealth, type HealthResult } from "../lib/health.ts";
import { ingestLog } from "../lib/ingest.ts";
import {
  createJob,
  listJobs,
} from "../lib/jobs.ts";
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
  searchLogs,
  tailLogs,
} from "../lib/query.ts";
import { summarizeLogs } from "../lib/summarize.ts";
import {
  getTestReport,
  searchTestReports,
  type TestReportEntry,
  type TestReportQuery,
} from "../lib/test-reports.ts";
import type {
  LogEntry,
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
} from "./types.ts";

/** SQLite-backed {@link Store}. Sole owner of the local database handle. */
export class LocalStore implements Store {
  readonly mode = "local" as const;

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
}
