/**
 * MON-V2-01 — deterministic predicate evaluation (design section 3).
 *
 * Every predicate returns a machine-readable result with a `passed` boolean.
 * The `observed` field is a fixed token (never raw output content), so results
 * are redaction-safe by construction. Same input must always produce the same
 * output.
 */

import { describe, it, expect } from "bun:test";
import {
  evaluateStringPredicate,
  evaluateJsonPredicate,
  evaluateAggregate,
} from "./predicates";

describe("evaluateStringPredicate", () => {
  it("equals matches exactly", () => {
    const r = evaluateStringPredicate("equals", "READY", "READY");
    expect(r).toEqual({ predicate: "equals", expected: "READY", observed: "matched", passed: true });
  });

  it("equals fails on difference", () => {
    const r = evaluateStringPredicate("equals", "READY", "ready");
    expect(r.passed).toBe(false);
    expect(r.observed).toBe("no match");
  });

  it("contains matches a substring", () => {
    const r = evaluateStringPredicate("contains", "READY", "STATUS: READY now");
    expect(r.passed).toBe(true);
    expect(r.observed).toBe("matched");
  });

  it("contains fails when absent", () => {
    const r = evaluateStringPredicate("contains", "ERROR", "STATUS: READY");
    expect(r.passed).toBe(false);
  });

  it("not_contains passes when absent", () => {
    const r = evaluateStringPredicate("not_contains", "ERROR", "STATUS: READY");
    expect(r.passed).toBe(true);
  });

  it("not_contains fails when present", () => {
    const r = evaluateStringPredicate("not_contains", "ERROR", "ERROR: boom");
    expect(r.passed).toBe(false);
  });

  it("regex matches the pattern", () => {
    const r = evaluateStringPredicate("regex", "^READY\\s*$", "READY");
    expect(r.passed).toBe(true);
  });

  it("regex fails without a match", () => {
    const r = evaluateStringPredicate("regex", "^READY\\s*$", "NOT READY");
    expect(r.passed).toBe(false);
    expect(r.observed).toBe("no regex match");
  });

  it("an invalid runtime regex fails closed with a fixed token", () => {
    const r = evaluateStringPredicate("regex", "([unclosed", "READY");
    expect(r.passed).toBe(false);
    expect(r.observed).toBe("regex error");
  });

  it("is deterministic — identical input yields identical output", () => {
    const a = evaluateStringPredicate("contains", "READY", "STATUS: READY now");
    const b = evaluateStringPredicate("contains", "READY", "STATUS: READY now");
    expect(a).toEqual(b);
  });
});

describe("evaluateJsonPredicate", () => {
  const sample = {
    status: "READY",
    mode: "prod",
    count: 3,
    ratio: 0.5,
    nested: { items: [{ name: "a" }, { name: "b" }] },
    nullable: null,
    enabled: true,
    version: "v1.2.3",
  };

  it("exists passes when the path resolves", () => {
    const r = evaluateJsonPredicate("exists", "status", undefined, sample);
    expect(r.passed).toBe(true);
    expect(r.observed).toBe("matched");
  });

  it("exists fails when the path is missing", () => {
    const r = evaluateJsonPredicate("exists", "missing.field", undefined, sample);
    expect(r.passed).toBe(false);
    expect(r.observed).toBe("path not found");
  });

  it("type accepts the declared JSON types", () => {
    expect(evaluateJsonPredicate("type", "status", "string", sample).passed).toBe(true);
    expect(evaluateJsonPredicate("type", "count", "number", sample).passed).toBe(true);
    expect(evaluateJsonPredicate("type", "enabled", "boolean", sample).passed).toBe(true);
    expect(evaluateJsonPredicate("type", "nullable", "null", sample).passed).toBe(true);
    expect(evaluateJsonPredicate("type", "nested", "object", sample).passed).toBe(true);
    expect(evaluateJsonPredicate("type", "nested.items", "array", sample).passed).toBe(true);
  });

  it("type fails on a mismatch", () => {
    const r = evaluateJsonPredicate("type", "status", "number", sample);
    expect(r.passed).toBe(false);
    expect(r.observed).toBe("type mismatch");
  });

  it("equals compares scalar values", () => {
    expect(evaluateJsonPredicate("equals", "status", "READY", sample).passed).toBe(true);
    expect(evaluateJsonPredicate("equals", "status", "DRAIN", sample).passed).toBe(false);
  });

  it("equals deep-compares objects and arrays", () => {
    expect(evaluateJsonPredicate("equals", "nested.items", [{ name: "a" }, { name: "b" }], sample).passed).toBe(true);
    expect(evaluateJsonPredicate("equals", "nested.items", [{ name: "a" }], sample).passed).toBe(false);
  });

  it("not_equals inverts equals", () => {
    expect(evaluateJsonPredicate("not_equals", "status", "DRAIN", sample).passed).toBe(true);
    expect(evaluateJsonPredicate("not_equals", "status", "READY", sample).passed).toBe(false);
  });

  it("greater_than compares numbers", () => {
    expect(evaluateJsonPredicate("greater_than", "count", 2, sample).passed).toBe(true);
    expect(evaluateJsonPredicate("greater_than", "count", 3, sample).passed).toBe(false);
  });

  it("greater_or_equal includes equality", () => {
    expect(evaluateJsonPredicate("greater_or_equal", "count", 3, sample).passed).toBe(true);
    expect(evaluateJsonPredicate("greater_or_equal", "count", 4, sample).passed).toBe(false);
  });

  it("less_than compares numbers", () => {
    expect(evaluateJsonPredicate("less_than", "count", 4, sample).passed).toBe(true);
    expect(evaluateJsonPredicate("less_than", "count", 3, sample).passed).toBe(false);
  });

  it("less_or_equal includes equality", () => {
    expect(evaluateJsonPredicate("less_or_equal", "count", 3, sample).passed).toBe(true);
    expect(evaluateJsonPredicate("less_or_equal", "count", 2, sample).passed).toBe(false);
  });

  it("numeric comparison against a non-number fails closed", () => {
    const r = evaluateJsonPredicate("greater_than", "status", 1, sample);
    expect(r.passed).toBe(false);
    expect(r.observed).toBe("not a number");
  });

  it("matches applies the regex to a string value", () => {
    expect(evaluateJsonPredicate("matches", "version", "^v\\d+\\.\\d+", sample).passed).toBe(true);
    expect(evaluateJsonPredicate("matches", "version", "^w\\d+", sample).passed).toBe(false);
  });

  it("matches against a non-string value fails closed", () => {
    const r = evaluateJsonPredicate("matches", "count", "^\\d+$", sample);
    expect(r.passed).toBe(false);
    expect(r.observed).toBe("not a string");
  });

  it("matches with an invalid pattern fails closed", () => {
    const r = evaluateJsonPredicate("matches", "version", "([unclosed", sample);
    expect(r.passed).toBe(false);
    expect(r.observed).toBe("regex error");
  });

  it("resolves nested paths with numeric indexes", () => {
    expect(evaluateJsonPredicate("equals", "nested.items.1.name", "b", sample).passed).toBe(true);
  });

  it("is deterministic — identical input yields identical output", () => {
    const a = evaluateJsonPredicate("equals", "nested.items", [{ name: "a" }, { name: "b" }], sample);
    const b = evaluateJsonPredicate("equals", "nested.items", [{ name: "a" }, { name: "b" }], sample);
    expect(a).toEqual(b);
  });
});

describe("evaluateAggregate", () => {
  const results = [
    { predicate: "exit", expected: "0", observed: "matched", passed: true },
    { predicate: "stdout.contains", expected: "READY", observed: "matched", passed: true },
    { predicate: "stdout.contains", expected: "ERROR", observed: "no match", passed: false },
  ];

  it("all passes only when every check passes", () => {
    expect(evaluateAggregate({ mode: "all" }, results).passed).toBe(false);
    expect(evaluateAggregate({ mode: "all" }, results.slice(0, 2)).passed).toBe(true);
  });

  it("any passes when at least one check passes", () => {
    expect(evaluateAggregate({ mode: "any" }, results).passed).toBe(true);
    expect(
      evaluateAggregate(
        { mode: "any" },
        results.map((r) => ({ ...r, passed: false })),
      ).passed,
    ).toBe(false);
  });

  it("threshold passes when the pass count meets minPass", () => {
    expect(evaluateAggregate({ mode: "threshold", minPass: 2 }, results).passed).toBe(true);
    expect(evaluateAggregate({ mode: "threshold", minPass: 3 }, results).passed).toBe(false);
  });

  it("threshold reports counts deterministically", () => {
    const r = evaluateAggregate({ mode: "threshold", minPass: 2 }, results);
    expect(r.observed).toBe("2 of 3 passed");
    expect(r.passed).toBe(true);
  });

  it("all reports the failing count", () => {
    const r = evaluateAggregate({ mode: "all" }, results);
    expect(r.observed).toBe("2 of 3 passed");
    expect(r.passed).toBe(false);
  });

  it("is deterministic — identical input yields identical output", () => {
    const a = evaluateAggregate({ mode: "threshold", minPass: 2 }, results);
    const b = evaluateAggregate({ mode: "threshold", minPass: 2 }, results);
    expect(a).toEqual(b);
  });
});
