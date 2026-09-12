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
  /** Counts per service. Logs with no service are keyed `-`. */
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

/** Clamp the `by_day` window to a whole number of days, defaulting to 7. */
export function statsWindowDays(days?: number): number {
  return Number.isFinite(days) && (days as number) > 0
    ? Math.min(Math.floor(days as number), 366)
    : 7;
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
  const total = byLevelRows.reduce((s, r) => s + r.c, 0);

  const bySvcRows = db
    .prepare(
      `SELECT COALESCE(service, '-') as service, COUNT(*) as c FROM logs ${where} GROUP BY service ORDER BY c DESC`,
    )
    .all(sqlBindings(params)) as { service: string; c: number }[];
  const by_service = Object.fromEntries(bySvcRows.map((r) => [r.service, r.c]));

  const bounds = db
    .prepare(
      `SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM logs ${where}`,
    )
    .get(sqlBindings(params)) as {
    oldest: string | null;
    newest: string | null;
  } | null;

  // NULL timestamps drop out of this filter, which is the same guard the CLI
  // used when it folded the rows itself.
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const dayWhere = [...conditions, "timestamp >= $since"].join(" AND ");
  const byDayRows = db
    .prepare(
      `SELECT substr(timestamp, 1, 10) as day, COUNT(*) as c FROM logs WHERE ${dayWhere} GROUP BY day ORDER BY day`,
    )
    .all(sqlBindings({ ...params, $since: since })) as {
    day: string;
    c: number;
  }[];
  const by_day = Object.fromEntries(byDayRows.map((r) => [r.day, r.c]));

  return {
    total,
    errors: by_level.error ?? 0,
    warns: by_level.warn ?? 0,
    fatals: by_level.fatal ?? 0,
    by_level,
    by_service,
    by_day,
    oldest: bounds?.oldest ?? null,
    newest: bounds?.newest ?? null,
  };
}
