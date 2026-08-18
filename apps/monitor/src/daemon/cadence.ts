/**
 * Cadence parsing and next-due computation for slug definitions.
 *
 * Supports interval cadences ("30s", "5m", "1h", "1d") and cron expressions
 * (5-field, via cron-parser — the same vocabulary node-cron uses elsewhere
 * in this package). All computations are pure functions of the clock, so
 * fake-clock tests stay deterministic.
 */

import { CronExpressionParser } from "cron-parser";

/**
 * cron-parser v5 is 6-field (seconds-first). The monitor vocabulary is the
 * node-cron 5-field shape ("* * * * *" — minute hour dom month dow), so a
 * 5-field expression is normalized by prefixing a seconds field. A 6-field
 * expression is accepted as-is.
 */
function normalizeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length === 5) return `0 ${parts.join(" ")}`;
  return expression.trim();
}

export type Cadence =
  | { type: "interval"; everyMs: number }
  | { type: "cron"; expression: string };

const INTERVAL_UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse "30s" | "5m" | "1h" | "1d" into milliseconds. Null on any malformed input. */
export function parseIntervalMs(every: string): number | null {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(every.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const unit = INTERVAL_UNITS[m[2] as keyof typeof INTERVAL_UNITS];
  if (unit === undefined) return null;
  return n * unit;
}

/**
 * Parse a cadence object from a slug definition. Returns null when the
 * cadence is malformed so the scheduler can skip the slug and report it,
 * rather than throwing.
 */
export function parseCadence(def: unknown): Cadence | null {
  if (typeof def !== "object" || def === null) return null;
  const d = def as Record<string, unknown>;
  if (d.type === "interval" && typeof d.every === "string") {
    const everyMs = parseIntervalMs(d.every);
    if (everyMs === null) return null;
    return { type: "interval", everyMs };
  }
  if (d.type === "cron" && typeof d.expression === "string") {
    const normalized = normalizeCron(d.expression);
    try {
      CronExpressionParser.parse(normalized);
    } catch {
      return null;
    }
    return { type: "cron", expression: normalized };
  }
  return null;
}

/** Validate a raw cadence object without constructing it. */
export function isValidCadence(def: unknown): boolean {
  return parseCadence(def) !== null;
}

/**
 * Next due time strictly after `afterMs` for a cadence. For intervals this
 * is `afterMs + everyMs`; for cron it is the next expression occurrence
 * strictly after `afterMs`. The reference is never clamped to `nowMs` —
 * the scheduler's loop admits every occurrence up to `nowMs`, so missed due
 * work is caught up (bounded by the loop guard) instead of skipped.
 */
export function nextDueAt(cadence: Cadence, afterMs: number, _nowMs: number): number {
  if (cadence.type === "interval") {
    return afterMs + cadence.everyMs;
  }
  const expr = CronExpressionParser.parse(cadence.expression, {
    currentDate: new Date(afterMs),
  });
  return expr.next().getTime();
}
