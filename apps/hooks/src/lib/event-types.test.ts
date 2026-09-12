/**
 * The shared hook-event vocabulary.
 *
 * The important test here is the DRIFT guard: `event-types.ts` carries its
 * own `normalizeEventType`/`resolveEventType` because `db-writer.ts` opens
 * `bun:sqlite` at import time and the hosted path must never import it. Two
 * copies of a validation rule is exactly how a hosted write starts accepting
 * something a local write rejects, so the two are compared here on every
 * input that matters.
 */

import { describe, expect, test } from "bun:test";
import {
  boundedRowLimit,
  buildEventFilter,
  HOOK_EVENT_TYPES,
  MAX_EVENT_ROWS,
  normalizeEventType,
  normalizeSince,
  resolveEventType,
} from "./event-types.js";
import { normalizeEventType as dbNormalizeEventType, resolveEventType as dbResolveEventType } from "./db-writer.js";

const INPUTS: unknown[] = [
  ...HOOK_EVENT_TYPES,
  "PreToolUse:Bash",
  "PostToolUse:Write|Edit",
  "SubagentStart",
  "NotAnEvent",
  "pretooluse",
  "",
  ":",
  null,
  undefined,
  42,
  { event: "Stop" },
];

describe("event-type normalization cannot drift from db-writer", () => {
  test("normalizeEventType agrees with db-writer on every input", () => {
    for (const input of INPUTS) {
      expect([input, normalizeEventType(input)]).toEqual([input, dbNormalizeEventType(input) as never]);
    }
  });

  test("resolveEventType agrees with db-writer, fallback included", () => {
    for (const input of INPUTS) {
      for (const fallback of ["PostToolUse", "Stop", "bogus", null]) {
        expect([input, fallback, resolveEventType(input, fallback)]).toEqual([
          input,
          fallback,
          dbResolveEventType(input, fallback) as never,
        ]);
      }
    }
  });
});

describe("normalizeSince", () => {
  test("passes an ISO timestamp through, normalized", () => {
    expect(normalizeSince("2026-09-11T10:00:00Z")).toBe("2026-09-11T10:00:00.000Z");
  });

  test("resolves a duration against the supplied clock", () => {
    const now = Date.parse("2026-09-11T12:00:00.000Z");
    expect(normalizeSince("2h", now)).toBe("2026-09-11T10:00:00.000Z");
    expect(normalizeSince("30m", now)).toBe("2026-09-11T11:30:00.000Z");
    expect(normalizeSince("7d", now)).toBe("2026-09-04T12:00:00.000Z");
    expect(normalizeSince("45s", now)).toBe("2026-09-11T11:59:15.000Z");
  });

  test("an unparseable value is null so the caller can apply its own default", () => {
    expect(normalizeSince("yesterday")).toBeNull();
    expect(normalizeSince("")).toBeNull();
    expect(normalizeSince(undefined)).toBeNull();
    expect(normalizeSince("2026-13-45T99:99:99Z")).toBeNull();
  });
});

describe("boundedRowLimit", () => {
  test("clamps to the ceiling and falls back for nonsense", () => {
    expect(boundedRowLimit(10, 50)).toBe(10);
    expect(boundedRowLimit(undefined, 50)).toBe(50);
    expect(boundedRowLimit(0, 50)).toBe(50);
    expect(boundedRowLimit(-5, 50)).toBe(50);
    expect(boundedRowLimit(NaN, 50)).toBe(50);
    expect(boundedRowLimit(10_000, 50)).toBe(MAX_EVENT_ROWS);
    expect(boundedRowLimit(10, 50, 5)).toBe(5);
  });
});

describe("buildEventFilter", () => {
  test("an empty query filters nothing", () => {
    expect(buildEventFilter({})).toEqual({ sql: "WHERE 1=1", params: [] });
  });

  test("each filter contributes its clause and its parameters in order", () => {
    const filter = buildEventFilter({
      hook: "commandlog",
      session: "sess",
      since: "2026-09-11T00:00:00.000Z",
      errorsOnly: true,
      search: "force",
    });
    expect(filter.sql).toBe(
      "WHERE 1=1 AND hook_name = ? AND session_id LIKE ? AND timestamp >= ? AND error IS NOT NULL AND (tool_input LIKE ? OR error LIKE ?)",
    );
    expect(filter.params).toEqual(["commandlog", "sess%", "2026-09-11T00:00:00.000Z", "%force%", "%force%"]);
  });

  test("the session filter is a prefix match, as every log surface has always treated it", () => {
    expect(buildEventFilter({ session: "abc" }).params).toEqual(["abc%"]);
  });
});
