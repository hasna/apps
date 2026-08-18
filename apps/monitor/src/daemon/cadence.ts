/**
 * Cadence parsing and next-due computation for slug definitions.
 *
 * Accepts the MON-V2-01 definition cadence shapes: interval cadences in
 * seconds (`{ type: "interval", seconds }`) and cron expressions with an
 * IANA timezone (`{ type: "cron", expression, timezone }`). The legacy
 * string-unit interval shape (`{ type: "interval", every: "5m" }`) is not
 * part of the v2 definition schema and is rejected. All computations are
 * pure functions of the clock, so fake-clock tests stay deterministic.
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
  | { type: "cron"; expression: string; timezone?: string };

/**
 * Parse a cadence object from a slug definition. Returns null when the
 * cadence is malformed so the scheduler can skip the slug and report it,
 * rather than throwing.
 */
export function parseCadence(def: unknown): Cadence | null {
  if (typeof def !== "object" || def === null) return null;
  const d = def as Record<string, unknown>;
  if (d.type === "interval" && typeof d.seconds === "number") {
    if (!Number.isSafeInteger(d.seconds) || d.seconds <= 0) return null;
    return { type: "interval", everyMs: d.seconds * 1000 };
  }
  if (d.type === "cron" && typeof d.expression === "string") {
    const timezone = typeof d.timezone === "string" && d.timezone.length > 0 ? d.timezone : undefined;
    const normalized = normalizeCron(d.expression);
    try {
      CronExpressionParser.parse(normalized, timezone ? { tz: timezone } : undefined);
    } catch {
      return null;
    }
    return { type: "cron", expression: normalized, timezone };
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
    ...(cadence.timezone ? { tz: cadence.timezone } : {}),
  });
  return expr.next().getTime();
}
