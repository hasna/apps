import type { Database } from "bun:sqlite";
import { parseTime } from "./parse-time.ts";
import { sqlBindings } from "./sqlite-bindings.ts";

export interface LogCount {
  total: number;
  errors: number;
  warns: number;
  fatals: number;
  by_level: Record<string, number>;
  by_service?: Record<string, number>;
}

export function countLogs(
  db: Database,
  opts: {
    project_id?: string;
    service?: string;
    level?: string;
    since?: string;
    until?: string;
    group_by?: "level" | "service";
  },
): LogCount {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.project_id) {
    conditions.push("project_id = $p");
    params.$p = opts.project_id;
  }
  if (opts.service) {
    conditions.push("service = $service");
    params.$service = opts.service;
  }
  if (opts.level) {
    conditions.push("level = $level");
    params.$level = opts.level;
  }
  const since = parseTime(opts.since);
  const until = parseTime(opts.until);
  if (since) {
    conditions.push("timestamp >= $since");
    params.$since = since;
  }
  if (until) {
    conditions.push("timestamp <= $until");
    params.$until = until;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const byLevel = db
    .prepare(`SELECT level, COUNT(*) as c FROM logs ${where} GROUP BY level`)
    .all(sqlBindings(params)) as { level: string; c: number }[];

  const by_level = Object.fromEntries(byLevel.map((r) => [r.level, r.c]));
  const total = byLevel.reduce((s, r) => s + r.c, 0);

  let by_service: Record<string, number> | undefined;
  if (opts.group_by === "service") {
    const bySvc = db
      .prepare(
        `SELECT COALESCE(service, '-') as service, COUNT(*) as c FROM logs ${where} GROUP BY service ORDER BY c DESC`,
      )
      .all(sqlBindings(params)) as { service: string; c: number }[];
    by_service = Object.fromEntries(bySvc.map((r) => [r.service, r.c]));
  }

  return {
    total,
    errors: by_level.error ?? 0,
    warns: by_level.warn ?? 0,
    fatals: by_level.fatal ?? 0,
    by_level,
    by_service,
  };
}

/**
 * Volume overview for `logs stats` / the `log_stats` MCP tool.
 *
 * This is the aggregate shape the `/v1/logs/stats` route answers. It exists so
 * neither the CLI nor the MCP server has to download the corpus and count it in
 * the client: before this, both asked for `listLogs({ limit: 100000 })` and
 * folded the rows locally, which moved up to 100k records over the wire to
 * produce a few dozen numbers.
 */
export interface LogStats {
  total: number;
  errors: number;
  warns: number;
  fatals: number;
  by_level: Record<string, number>;
  /** Up to five highest-volume services. Missing services are keyed `-`. */
  by_service: Record<string, number>;
  /** Counts per UTC day (`YYYY-MM-DD`) over the trailing window. */
  by_day: Record<string, number>;
  oldest: string | null;
  newest: string | null;
}

export interface StatsLogsInput {
  project_id?: string;
  /** Trailing window for `by_day`, in days. Defaults to 7. */
  days?: number;
}

const STATS_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/i;

/** Clamp the `by_day` window to a whole number in [1, 366], defaulting to 7. */
export function statsWindowDays(days?: number): number {
  if (!Number.isFinite(days) || (days as number) <= 0) return 7;
  return Math.min(Math.max(Math.floor(days as number), 1), 366);
}

function parseStatsTimestamp(value: string): number | null {
  const match = STATS_TIMESTAMP_RE.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHours = Number(offsetHourText ?? 0);
  const offsetMinutesPart = Number(offsetMinuteText ?? 0);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHours > 15 ||
    offsetMinutesPart > 59
  ) {
    return null;
  }
  const parseValue =
    zone?.toUpperCase() !== "Z" && offsetMinuteText === undefined
      ? `${value.slice(0, -(zone?.length ?? 0))}${sign}${offsetHourText}:00`
      : value;
  const parsed = Date.parse(parseValue);
  if (!Number.isFinite(parsed)) return null;

  // Date.parse normalizes impossible calendar dates (for example Feb 30).
  // Shift the instant back into the input's stated local offset and require
  // every calendar component to round-trip exactly.
  const offsetMinutes =
    zone?.toUpperCase() === "Z"
      ? 0
      : (sign === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutesPart);
  const local = new Date(parsed + offsetMinutes * 60_000);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() + 1 !== month ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    return null;
  }
  return parsed;
}

function requiredCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Malformed Logs stats response: ${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function requiredCountMap(value: unknown, label: string): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Malformed Logs stats response: ${label} must be an object`);
  }
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    result[key] = requiredCount(count, `${label}.${key}`);
  }
  return result;
}

function requiredNullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || parseStatsTimestamp(value) === null) {
    throw new Error(`Malformed Logs stats response: ${label} must be a finite timestamp or null`);
  }
  return value;
}

/** Validate the hosted wire contract before CLI/MCP consumers perform math. */
export function parseLogStats(value: unknown): LogStats {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed Logs stats response: expected an object");
  }
  const record = value as Record<string, unknown>;
  const total = requiredCount(record.total, "total");
  const errors = requiredCount(record.errors, "errors");
  const warns = requiredCount(record.warns, "warns");
  const fatals = requiredCount(record.fatals, "fatals");
  const by_level = requiredCountMap(record.by_level, "by_level");
  const by_service = requiredCountMap(record.by_service, "by_service");
  const by_day = requiredCountMap(record.by_day, "by_day");
  const oldest = requiredNullableTimestamp(record.oldest, "oldest");
  const newest = requiredNullableTimestamp(record.newest, "newest");

  const levelTotal = Object.values(by_level).reduce((sum, count) => sum + count, 0);
  if (levelTotal !== total) {
    throw new Error("Malformed Logs stats response: by_level does not sum to total");
  }
  if (errors !== (by_level.error ?? 0) || warns !== (by_level.warn ?? 0) || fatals !== (by_level.fatal ?? 0)) {
    throw new Error("Malformed Logs stats response: level counters disagree with by_level");
  }

  return {
    total,
    errors,
    warns,
    fatals,
    by_level,
    by_service,
    by_day,
    oldest,
    newest,
  };
}

export function statsLogs(db: Database, opts: StatsLogsInput = {}): LogStats {
  const days = statsWindowDays(opts.days);
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.project_id) {
    conditions.push("project_id = $p");
    params.$p = opts.project_id;
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const byLevelRows = db
    .prepare(`SELECT level, COUNT(*) as c FROM logs ${where} GROUP BY level`)
    .all(sqlBindings(params)) as { level: string; c: number }[];
  const by_level = Object.fromEntries(byLevelRows.map((r) => [r.level, r.c]));
  const total = byLevelRows.reduce((sum, row) => sum + row.c, 0);

  const bySvcRows = db
    .prepare(
      `SELECT COALESCE(service, '-') as service, COUNT(*) as c
         FROM logs ${where}
        GROUP BY COALESCE(service, '-')
        ORDER BY c DESC, service ASC
        LIMIT 5`,
    )
    .all(sqlBindings(params)) as { service: string; c: number }[];
  const by_service = Object.fromEntries(bySvcRows.map((row) => [row.service, row.c]));

  // Local timestamp strings are user-controlled legacy data. Parse only the
  // narrow explicit-zone forms the hosted query admits, using JavaScript's
  // calendar validation so valid +HHMM offsets work and impossible times do
  // not become SQLite-normalized bounds or buckets.
  const timestampRows = db
    .prepare(`SELECT timestamp FROM logs ${where}`)
    .all(sqlBindings(params)) as { timestamp: string }[];
  const since = Date.now() - days * 86_400_000;
  let oldestMs: number | null = null;
  let newestMs: number | null = null;
  const by_day: Record<string, number> = {};
  for (const row of timestampRows) {
    const observedAt = parseStatsTimestamp(row.timestamp);
    if (observedAt === null) continue;
    oldestMs = oldestMs === null ? observedAt : Math.min(oldestMs, observedAt);
    newestMs = newestMs === null ? observedAt : Math.max(newestMs, observedAt);
    if (observedAt >= since) {
      const day = new Date(observedAt).toISOString().slice(0, 10);
      by_day[day] = (by_day[day] ?? 0) + 1;
    }
  }

  return {
    total,
    errors: by_level.error ?? 0,
    warns: by_level.warn ?? 0,
    fatals: by_level.fatal ?? 0,
    by_level,
    by_service,
    by_day,
    oldest: oldestMs === null ? null : new Date(oldestMs).toISOString(),
    newest: newestMs === null ? null : new Date(newestMs).toISOString(),
  };
}
