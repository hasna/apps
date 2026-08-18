/**
 * MON-V2-01 — machine-checkable predicate evaluation (design section 3,
 * `apps/monitor/src/slugs/predicates.ts`).
 *
 * Every predicate returns a machine-readable result carrying a `passed`
 * boolean and a fixed `observed` token. `observed` is deliberately NOT raw
 * output content: predicate results are redaction-safe by construction and
 * deterministic — the same input always produces the same output.
 */

import type { ChecksAggregate, StringPredicateOp, JsonPredicateOp } from "./schema";

// ── Result shape ──────────────────────────────────────────────────────────────

export interface PredicateResult {
  /** e.g. "contains" for a string predicate; the check evaluator composes the channel prefix. */
  predicate: string;
  expected: string;
  observed: string;
  passed: boolean;
}

// ── String predicates ─────────────────────────────────────────────────────────

function regexTest(pattern: string, actual: string): { matched: boolean; error: boolean } {
  try {
    return { matched: new RegExp(pattern).test(actual), error: false };
  } catch {
    return { matched: false, error: true };
  }
}

export function evaluateStringPredicate(
  op: StringPredicateOp,
  expected: string,
  actual: string,
): PredicateResult {
  const base = { predicate: op, expected };

  switch (op) {
    case "equals":
      return actual === expected
        ? { ...base, observed: "matched", passed: true }
        : { ...base, observed: "no match", passed: false };
    case "contains":
      return actual.includes(expected)
        ? { ...base, observed: "matched", passed: true }
        : { ...base, observed: "no match", passed: false };
    case "not_contains":
      return !actual.includes(expected)
        ? { ...base, observed: "matched", passed: true }
        : { ...base, observed: "no match", passed: false };
    case "regex": {
      const { matched, error } = regexTest(expected, actual);
      if (error) return { ...base, observed: "regex error", passed: false };
      return matched
        ? { ...base, observed: "matched", passed: true }
        : { ...base, observed: "no regex match", passed: false };
    }
  }
}

// ── JSON predicates ───────────────────────────────────────────────────────────

/**
 * Resolve a dot-path (numeric segments index arrays) inside a parsed JSON
 * value. Returns undefined when any segment cannot be resolved.
 */
export function resolveJsonPath(value: unknown, path: string): unknown {
  if (path.length === 0) return value;
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function jsonTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }
  return false;
}

export function evaluateJsonPredicate(
  op: JsonPredicateOp,
  path: string,
  expected: unknown,
  parsed: unknown,
): PredicateResult {
  const base = { predicate: op, expected: expected === undefined ? "" : String(expected) };
  const value = resolveJsonPath(parsed, path);

  if (op === "exists") {
    return value !== undefined
      ? { ...base, observed: "matched", passed: true }
      : { ...base, observed: "path not found", passed: false };
  }

  if (value === undefined) {
    return { ...base, observed: "path not found", passed: false };
  }

  switch (op) {
    case "type": {
      const actualType = jsonTypeName(value);
      return actualType === expected
        ? { ...base, observed: "matched", passed: true }
        : { ...base, observed: "type mismatch", passed: false };
    }
    case "equals":
      return deepEqual(value, expected)
        ? { ...base, observed: "matched", passed: true }
        : { ...base, observed: "no match", passed: false };
    case "not_equals":
      return !deepEqual(value, expected)
        ? { ...base, observed: "matched", passed: true }
        : { ...base, observed: "no match", passed: false };
    case "greater_than":
    case "greater_or_equal":
    case "less_than":
    case "less_or_equal": {
      if (typeof value !== "number" || typeof expected !== "number") {
        return { ...base, observed: "not a number", passed: false };
      }
      const passed =
        op === "greater_than"
          ? value > expected
          : op === "greater_or_equal"
            ? value >= expected
            : op === "less_than"
              ? value < expected
              : value <= expected;
      return passed
        ? { ...base, observed: "matched", passed: true }
        : { ...base, observed: "no match", passed: false };
    }
    case "matches": {
      if (typeof value !== "string" || typeof expected !== "string") {
        return { ...base, observed: "not a string", passed: false };
      }
      const { matched, error } = regexTest(expected, value);
      if (error) return { ...base, observed: "regex error", passed: false };
      return matched
        ? { ...base, observed: "matched", passed: true }
        : { ...base, observed: "no regex match", passed: false };
    }
  }
}

// ── Aggregate pass condition ──────────────────────────────────────────────────

export interface AggregateOutcome {
  passed: boolean;
  observed: string;
  passedCount: number;
  total: number;
}

/**
 * Apply the explicit aggregate pass condition (all / any / threshold N of M)
 * to a set of check results. Deterministic: same inputs, same outcome.
 */
export function evaluateAggregate(
  aggregate: ChecksAggregate,
  results: readonly PredicateResult[],
): AggregateOutcome {
  const passedCount = results.filter((r) => r.passed).length;
  const total = results.length;
  const observed = `${passedCount} of ${total} passed`;

  let passed: boolean;
  switch (aggregate.mode) {
    case "all":
      passed = total > 0 && passedCount === total;
      break;
    case "any":
      passed = passedCount > 0;
      break;
    case "threshold":
      passed = passedCount >= aggregate.minPass;
      break;
  }

  return { passed, observed, passedCount, total };
}
