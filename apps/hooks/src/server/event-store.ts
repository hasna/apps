/**
 * The hook-event store behind `hooks-serve`.
 *
 * `hooks run`, the MCP run tools and the bundled observability hooks used to
 * write their events straight into `~/.hasna/hooks/hooks.db` on whatever
 * machine fired them, and `hooks log` read them back from there — the events
 * existed only on that one box. The hosted route (`POST/GET/DELETE
 * /api/v1/events`) puts them in the server's PostgreSQL, so a fleet station
 * reads its own events over the API and needs no local database at all.
 *
 * PostgreSQL only: the server bundle must never import `bun:sqlite`. The
 * schema is the one `src/db/pg-migrations.ts` already defines for the hooks
 * PostgreSQL backend, so an existing hooks database keeps working.
 *
 * When no DSN is configured the store does not exist and the routes answer
 * 503. They never answer with empty data — a `[]` for events the server does
 * not actually model would read as "no events" to a caller whose events are
 * simply somewhere else.
 */

import { PG_MIGRATIONS } from "../db/pg-migrations.js";
import { PgAdapterAsync } from "../db/remote-storage.js";
import {
  boundedRowLimit,
  buildEventFilter,
  HOOK_EVENT_TYPES,
  type FeedbackInput,
  type HookEventInput,
  type HookEventQuery,
  type HookEventRecord,
  type HookEventSummaryRow,
  type HookEventType,
} from "../lib/event-types.js";

export const HOOK_EVENT_STORE_DSN_ENV = ["HASNA_HOOKS_DATABASE_URL", "HOOKS_DATABASE_URL"] as const;

export const HOOK_EVENT_STORE_UNCONFIGURED =
  `hook event store is not configured: set ${HOOK_EVENT_STORE_DSN_ENV[0]} on the server ` +
  `(the events and feedback routes persist to PostgreSQL; they never answer from an empty stub)`;

/** Raised for a caller mistake — the route turns it into a 400. */
export class HookEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookEventValidationError";
  }
}

export interface HookEventStore {
  insertEvents(events: HookEventInput[]): Promise<HookEventRecord[]>;
  listEvents(query: HookEventQuery): Promise<HookEventRecord[]>;
  deleteEvents(filter: { hook?: string }): Promise<number>;
  summarize(since: string | null): Promise<HookEventSummaryRow[]>;
  insertFeedback(input: FeedbackInput): Promise<{ id: string }>;
  close(): Promise<void>;
}

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(HOOK_EVENT_TYPES);
const EVENT_COLUMNS =
  "id, timestamp, session_id, hook_name, event_type, tool_name, tool_input, result, error, duration_ms, project_dir, metadata";

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 21);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HookEventValidationError(`'${field}' is required and must be a non-empty string`);
  }
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HookEventValidationError(`'${field}' must be a string when present`);
  return value;
}

/** Validate and normalize one submitted event. Throws `HookEventValidationError` on bad input. */
export function normalizeSubmittedEvent(raw: unknown): HookEventRecord {
  if (!raw || typeof raw !== "object") throw new HookEventValidationError("each event must be an object");
  const event = raw as Record<string, unknown>;
  const eventType = event.event_type;
  if (typeof eventType !== "string" || !EVENT_TYPE_SET.has(eventType)) {
    throw new HookEventValidationError(
      `'event_type' must be one of ${HOOK_EVENT_TYPES.join(", ")} (got ${JSON.stringify(eventType)})`,
    );
  }
  const result = event.result;
  if (result !== undefined && result !== null && result !== "continue" && result !== "block") {
    throw new HookEventValidationError("'result' must be 'continue', 'block' or null");
  }
  const durationRaw = event.duration_ms;
  let duration: number | null = null;
  if (durationRaw !== undefined && durationRaw !== null) {
    if (typeof durationRaw !== "number" || !Number.isFinite(durationRaw)) {
      throw new HookEventValidationError("'duration_ms' must be a finite number when present");
    }
    duration = Math.trunc(durationRaw);
  }
  const timestamp =
    typeof event.timestamp === "string" && !Number.isNaN(Date.parse(event.timestamp))
      ? new Date(event.timestamp).toISOString()
      : new Date().toISOString();

  return {
    id: typeof event.id === "string" && event.id.trim() !== "" ? event.id : newId(),
    timestamp,
    session_id: requireString(event.session_id, "session_id"),
    hook_name: requireString(event.hook_name, "hook_name"),
    event_type: eventType as HookEventType,
    tool_name: optionalText(event.tool_name, "tool_name"),
    tool_input: optionalText(event.tool_input, "tool_input"),
    result: (result ?? null) as "continue" | "block" | null,
    error: optionalText(event.error, "error"),
    duration_ms: duration,
    project_dir: optionalText(event.project_dir, "project_dir"),
    metadata: optionalText(event.metadata, "metadata"),
  };
}

function rowToRecord(row: Record<string, unknown>): HookEventRecord {
  return {
    id: String(row.id),
    timestamp: String(row.timestamp),
    session_id: String(row.session_id),
    hook_name: String(row.hook_name),
    event_type: row.event_type as HookEventType,
    tool_name: (row.tool_name as string | null) ?? null,
    tool_input: (row.tool_input as string | null) ?? null,
    result: (row.result as "continue" | "block" | null) ?? null,
    error: (row.error as string | null) ?? null,
    duration_ms: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    project_dir: (row.project_dir as string | null) ?? null,
    metadata: (row.metadata as string | null) ?? null,
  };
}

export class PostgresHookEventStore implements HookEventStore {
  private readonly pg: PgAdapterAsync;
  private migrated: Promise<void> | null = null;

  constructor(dsn: string) {
    this.pg = new PgAdapterAsync(dsn);
  }

  /** Idempotent: every statement in PG_MIGRATIONS is CREATE/ALTER ... IF [NOT] EXISTS. */
  private ensureSchema(): Promise<void> {
    if (!this.migrated) {
      this.migrated = (async () => {
        for (const statement of PG_MIGRATIONS) await this.pg.run(statement);
      })().catch((error) => {
        this.migrated = null;
        throw error;
      });
    }
    return this.migrated;
  }

  async insertEvents(events: HookEventInput[]): Promise<HookEventRecord[]> {
    await this.ensureSchema();
    const records = events.map((event) => normalizeSubmittedEvent(event));
    for (const record of records) {
      await this.pg.run(
        `INSERT INTO hook_events (${EVENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        record.id,
        record.timestamp,
        record.session_id,
        record.hook_name,
        record.event_type,
        record.tool_name,
        record.tool_input,
        record.result,
        record.error,
        record.duration_ms,
        record.project_dir,
        record.metadata,
      );
    }
    return records;
  }

  async listEvents(query: HookEventQuery): Promise<HookEventRecord[]> {
    await this.ensureSchema();
    const filter = buildEventFilter(query);
    const limit = boundedRowLimit(query.limit, 50);
    const rows = (await this.pg.all(
      `SELECT ${EVENT_COLUMNS} FROM hook_events ${filter.sql} ORDER BY timestamp DESC LIMIT ?`,
      ...filter.params,
      limit,
    )) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  async deleteEvents(filter: { hook?: string }): Promise<number> {
    await this.ensureSchema();
    const result = filter.hook
      ? await this.pg.run("DELETE FROM hook_events WHERE hook_name = ?", filter.hook)
      : await this.pg.run("DELETE FROM hook_events");
    return result.changes;
  }

  async summarize(since: string | null): Promise<HookEventSummaryRow[]> {
    await this.ensureSchema();
    const sql =
      "SELECT hook_name, COUNT(*) AS total, SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors " +
      `FROM hook_events ${since ? "WHERE timestamp >= ?" : ""} GROUP BY hook_name ORDER BY total DESC`;
    const rows = (await (since ? this.pg.all(sql, since) : this.pg.all(sql))) as Record<string, unknown>[];
    return rows.map((row) => ({
      hook_name: String(row.hook_name),
      total: Number(row.total ?? 0),
      errors: Number(row.errors ?? 0),
    }));
  }

  async insertFeedback(input: FeedbackInput): Promise<{ id: string }> {
    await this.ensureSchema();
    const id = newId();
    await this.pg.run(
      "INSERT INTO feedback (id, message, email, category, version) VALUES (?, ?, ?, ?, ?)",
      id,
      requireString(input.message, "message"),
      input.email ?? null,
      input.category ?? "general",
      input.version ?? null,
    );
    return { id };
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

/** The configured DSN, or undefined when the server has no event store. */
export function hookEventStoreDsn(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const key of HOOK_EVENT_STORE_DSN_ENV) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

let cached: { dsn: string; store: HookEventStore } | null = null;

/**
 * The process-wide store, opened on first use and reused (one pg Pool per
 * server, not one per request). Returns null when no DSN is configured; the
 * routes turn that into a 503.
 */
export function resolveHookEventStore(
  env: Record<string, string | undefined> = process.env,
): HookEventStore | null {
  const dsn = hookEventStoreDsn(env);
  if (!dsn) return null;
  if (cached && cached.dsn === dsn) return cached.store;
  cached = { dsn, store: new PostgresHookEventStore(dsn) };
  return cached.store;
}

/** Test seam: drop the cached pool so a later resolve opens a fresh one. */
export function __resetHookEventStore(): void {
  cached = null;
}
