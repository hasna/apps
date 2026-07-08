/**
 * @hasna/logs — event-catalog watch queries (local SQLite).
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Pure, db-parameterized helpers that back the local event-catalog live-tail
 * for the CLI (`logs watch --events`) and the MCP `event_watch` tool. They
 * receive the `Database` handle from {@link LocalStore} — callers (CLI/MCP)
 * never acquire `getDb()` themselves, keeping the split-brain boundary intact.
 */
import type { Database } from "bun:sqlite";
import { type EventCatalogEntry, getEvent } from "./events.ts";

// ── shared filters ──────────────────────────────────────────
export interface EventWatchFilter {
  event_type?: string;
  source?: string;
  severity?: string;
  project_id?: string;
  machine_id?: string;
  repo_id?: string;
  app_id?: string;
  process_id?: string;
  run_id?: string;
  trace_id?: string;
  session_id?: string;
  environment?: string;
}

function addListFilter(
  conditions: string[],
  params: Array<string | number>,
  column: string,
  value: string | undefined,
): void {
  const values =
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];
  if (values.length === 0) return;
  conditions.push(`${column} IN (${values.map(() => "?").join(",")})`);
  params.push(...values);
}

function addScalarFilter(
  conditions: string[],
  params: Array<string | number>,
  column: string,
  value: string | undefined,
): void {
  if (!value) return;
  conditions.push(`${column} = ?`);
  params.push(value);
}

function addCommonFilters(
  conditions: string[],
  params: Array<string | number>,
  filter: EventWatchFilter,
): void {
  addListFilter(conditions, params, "event_type", filter.event_type);
  addListFilter(conditions, params, "source", filter.source);
  addListFilter(conditions, params, "severity", filter.severity);
  addScalarFilter(conditions, params, "project_id", filter.project_id);
  addScalarFilter(conditions, params, "machine_id", filter.machine_id);
  addScalarFilter(conditions, params, "repo_id", filter.repo_id);
  addScalarFilter(conditions, params, "app_id", filter.app_id);
  addScalarFilter(conditions, params, "process_id", filter.process_id);
  addScalarFilter(conditions, params, "run_id", filter.run_id);
  addScalarFilter(conditions, params, "trace_id", filter.trace_id);
  addScalarFilter(conditions, params, "session_id", filter.session_id);
  addScalarFilter(conditions, params, "environment", filter.environment);
}

function escapeLikeJson(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ── CLI catalog watch (`logs watch --events`) ───────────────
export interface CliEventWatchFilter extends EventWatchFilter {
  /** Extra convenience filter: match service either in metadata or message. */
  service?: string;
}

export type WatchEventRow = Omit<EventCatalogEntry, "metadata" | "raw"> & {
  rowid: number;
  metadata: Record<string, unknown> | null;
};

type WatchEventSqlRow = Omit<WatchEventRow, "metadata"> & {
  metadata: string | null;
};

function buildCliWatchWhere(
  filter: CliEventWatchFilter,
  afterRowid: number | null,
  since: string | undefined,
): { where: string; params: Array<string | number> } {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (afterRowid !== null) {
    conditions.push("rowid > ?");
    params.push(afterRowid);
  }
  addCommonFilters(conditions, params, filter);
  if (since) {
    conditions.push("event_time >= ?");
    params.push(since);
  }
  if (filter.service) {
    conditions.push("(metadata LIKE ? OR message LIKE ?)");
    params.push(
      `%"service":"${escapeLikeJson(filter.service)}"%`,
      `%${filter.service}%`,
    );
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function queryWatchEventRows(
  db: Database,
  filter: CliEventWatchFilter,
  afterRowid: number,
  since: string | undefined,
  limit: number,
): WatchEventRow[] {
  const { where, params } = buildCliWatchWhere(filter, afterRowid, since);
  const rows = db
    .query(
      `SELECT rowid, * FROM event_records ${where} ORDER BY rowid ASC LIMIT ?`,
    )
    .all(...params, limit) as WatchEventSqlRow[];
  return rows.map((row) => ({ ...row, metadata: parseMetadata(row.metadata) }));
}

export function latestMatchingEventRowid(
  db: Database,
  filter: CliEventWatchFilter,
): number {
  const { where, params } = buildCliWatchWhere(filter, null, undefined);
  const row = db
    .query(
      `SELECT rowid FROM event_records ${where} ORDER BY rowid DESC LIMIT 1`,
    )
    .get(...params) as { rowid: number } | null;
  return row?.rowid ?? 0;
}

export function rowidForEventId(db: Database, eventId: string): number | null {
  const row = db
    .query("SELECT rowid FROM event_records WHERE event_id = ?")
    .get(eventId) as { rowid: number } | null;
  return row?.rowid ?? null;
}

// ── MCP cursor watch (`event_watch` tool) ───────────────────
export interface McpEventWatchArgs extends EventWatchFilter {
  last_event_id?: string;
  limit?: number;
  include_raw?: boolean;
  from_start?: boolean;
  include_internal?: boolean;
}

interface McpEventCursor {
  rowid: number;
  event_id: string;
}

export interface McpEventWatchResult {
  events: unknown[];
  cursor: string | null;
  has_more: boolean;
  overflow: null | { reason: string; last_event_id: string };
}

function buildMcpEventWhere(
  args: McpEventWatchArgs,
  afterRowid: number | null,
): { where: string; params: Array<string | number> } {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (afterRowid !== null) {
    conditions.push("rowid > ?");
    params.push(afterRowid);
  }
  addCommonFilters(conditions, params, args);
  if (args.include_internal !== true) {
    conditions.push(
      "NOT (event_type = 'agent' AND source = 'mcp' AND metadata LIKE ?)",
    );
    params.push('%"category":"mcp_tool_call"%');
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

function clampMcpWatchLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return 100;
  return Math.min(Math.max(1, Math.floor(value)), 1_000);
}

function latestMcpEventCursor(
  db: Database,
  args: McpEventWatchArgs,
): McpEventCursor | null {
  const { where, params } = buildMcpEventWhere(args, null);
  return db
    .prepare(
      `SELECT rowid, event_id FROM event_records ${where} ORDER BY rowid DESC LIMIT 1`,
    )
    .get(...params) as McpEventCursor | null;
}

function queryMcpEventCursors(
  db: Database,
  args: McpEventWatchArgs,
  afterRowid: number,
  limit: number,
): McpEventCursor[] {
  const { where, params } = buildMcpEventWhere(args, afterRowid);
  return db
    .prepare(
      `SELECT rowid, event_id FROM event_records ${where} ORDER BY rowid ASC LIMIT ?`,
    )
    .all(...params, limit) as McpEventCursor[];
}

export function watchEventsForMcp(
  db: Database,
  args: McpEventWatchArgs,
): McpEventWatchResult {
  const limit = clampMcpWatchLimit(args.limit);
  const latest = latestMcpEventCursor(db, args);
  let afterRowid = 0;
  let cursor = args.last_event_id ?? latest?.event_id ?? null;
  let overflow: null | { reason: string; last_event_id: string } = null;

  if (args.last_event_id) {
    const anchor = db
      .prepare("SELECT rowid, event_id FROM event_records WHERE event_id = ?")
      .get(args.last_event_id) as McpEventCursor | null;
    if (!anchor) {
      overflow = {
        reason: "last_event_id_unknown",
        last_event_id: args.last_event_id,
      };
      return {
        events: [],
        cursor: latest?.event_id ?? null,
        has_more: false,
        overflow,
      };
    }
    afterRowid = anchor.rowid;
    cursor = anchor.event_id;
  } else if (args.from_start !== true) {
    return { events: [], cursor, has_more: false, overflow: null };
  }

  const rows = queryMcpEventCursors(db, args, afterRowid, limit + 1);
  const visibleRows = rows.slice(0, limit);
  const events = visibleRows
    .map((row) => getEvent(db, row.event_id, args.include_raw === true))
    .filter(Boolean);
  const last = visibleRows.at(-1);
  if (last) cursor = last.event_id;

  return { events, cursor, has_more: rows.length > limit, overflow };
}
