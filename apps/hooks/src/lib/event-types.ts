/**
 * Hook-event vocabulary shared by the client sink and the server store.
 *
 * This module is deliberately dependency-free: `src/serve.ts` and
 * `src/server/event-store.ts` must never pull `bun:sqlite` into the server
 * bundle, and the bundled hook scripts must not pull the resolver into a
 * sandboxed child just to name an event type. Everything here is types plus
 * pure functions.
 */

export const HOOK_EVENT_TYPES = [
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "Notification",
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "SubagentStart",
] as const;

export type HookEventType = (typeof HOOK_EVENT_TYPES)[number];

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(HOOK_EVENT_TYPES);

/** A hook event as a writer submits it. `id`/`timestamp` are assigned by the store. */
export interface HookEventInput {
  session_id: string;
  hook_name: string;
  event_type: HookEventType;
  tool_name?: string | null;
  tool_input?: string | null;
  result?: "continue" | "block" | null;
  error?: string | null;
  duration_ms?: number | null;
  project_dir?: string | null;
  metadata?: string | null;
  timestamp?: string;
}

/** A hook event as the store returns it. */
export interface HookEventRecord extends HookEventInput {
  id: string;
  timestamp: string;
}

/** The read filter the `/api/v1/events` route and the log surfaces share. */
export interface HookEventQuery {
  /** Exact hook name. */
  hook?: string;
  /** Session id PREFIX (the CLI/MCP surfaces have always matched on a prefix). */
  session?: string;
  /** ISO timestamp lower bound (inclusive). */
  since?: string;
  /** Substring match against `tool_input` or `error`. */
  search?: string;
  /** Only rows whose `error` is set. */
  errorsOnly?: boolean;
  /** Max rows. The store clamps it. */
  limit?: number;
}

export interface HookEventSummaryRow {
  hook_name: string;
  total: number;
  errors: number;
}

export interface HookEventSummary {
  since: string | null;
  hooks: Array<HookEventSummaryRow & { error_rate: string }>;
  totals: { events: number; errors: number; hooks_active: number };
}

export interface FeedbackInput {
  message: string;
  email?: string | null;
  category?: string | null;
  version?: string | null;
}

/** Hard ceiling for a single read, applied on the server as well as the client. */
export const MAX_EVENT_ROWS = 500;

export function boundedRowLimit(value: number | undefined, fallback: number, max = MAX_EVENT_ROWS): number {
  if (value === undefined || !Number.isFinite(value)) return Math.min(fallback, max);
  const n = Math.floor(value);
  if (n <= 0) return Math.min(fallback, max);
  return Math.min(n, max);
}

/**
 * Normalize a `since` argument that is either an ISO timestamp or a duration
 * string (`30m`, `2h`, `7d`) to an ISO timestamp. Returns null when neither.
 *
 * The four log surfaces each carried their own copy of this parser; the
 * hosted path resolves it once so the CLI, the MCP tools and the route agree.
 */
export function normalizeSince(value: string | undefined | null, now: number = Date.now()): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}/.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  const match = /^(\d+)(s|m|h|d)$/.exec(trimmed);
  if (!match) return null;
  const n = parseInt(match[1]!, 10);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return new Date(now - n * unit).toISOString();
}

/**
 * The `WHERE` fragment + bound parameters for a hook-event query, in the
 * `?`-placeholder dialect both stores speak (bun:sqlite directly, PostgreSQL
 * through `PgAdapterAsync`'s translation).
 *
 * One builder serves the server store and the local-opt-in branches of the
 * CLI and MCP log surfaces, so a hosted read and a local read cannot drift
 * into answering the same question differently.
 */
export function buildEventFilter(query: HookEventQuery): { sql: string; params: unknown[] } {
  let sql = "WHERE 1=1";
  const params: unknown[] = [];
  if (query.hook) {
    sql += " AND hook_name = ?";
    params.push(query.hook);
  }
  if (query.session) {
    sql += " AND session_id LIKE ?";
    params.push(`${query.session}%`);
  }
  if (query.since) {
    sql += " AND timestamp >= ?";
    params.push(query.since);
  }
  if (query.errorsOnly) {
    sql += " AND error IS NOT NULL";
  }
  if (query.search) {
    sql += " AND (tool_input LIKE ? OR error LIKE ?)";
    params.push(`%${query.search}%`, `%${query.search}%`);
  }
  return { sql, params };
}

/**
 * Normalize a `hook_event_name` from hook input to a value the schema accepts.
 *
 * Mirrors `normalizeEventType` in `src/lib/db-writer.ts` — that module opens
 * SQLite at import time, so the hosted path cannot import it. `event-types.test.ts`
 * asserts the two implementations agree on every input, so the copy cannot drift.
 */
export function normalizeEventType(value: unknown): HookEventType | null {
  if (typeof value !== "string") return null;
  if (EVENT_TYPE_SET.has(value)) return value as HookEventType;
  const bare = value.split(":")[0] ?? "";
  return EVENT_TYPE_SET.has(bare) ? (bare as HookEventType) : null;
}

/** Pick the event type for a run record: the hook input's name, else the hook's declared event. */
export function resolveEventType(inputEvent: unknown, fallbackEvent: string | null | undefined): HookEventType | null {
  return normalizeEventType(inputEvent) ?? normalizeEventType(fallbackEvent ?? null);
}
