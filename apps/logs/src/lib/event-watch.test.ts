/**
 * Test gap coverage for src/lib/event-watch.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The watch-query module (CLI `logs watch --events` and MCP `event_watch`)
 * had no sibling test. These tests pin the SQL filter contract — list vs
 * scalar filters, LIKE-escaping of the service filter, rowid cursoring, the
 * MCP cursor/overflow semantics, and the limit clamp — against a real
 * in-memory SQLite event catalog.
 */
import { describe, expect, it } from "bun:test";
import { createTestDb } from "../db/index.ts";
import { appendRawEvent, indexRawEvent } from "./event-store.ts";
import {
  clampMcpWatchLimit,
  latestMatchingEventRowid,
  matchesEventService,
  queryWatchEventRows,
  rowidForEventId,
  type CliEventWatchFilter,
  type McpEventWatchArgs,
  watchEventsForMcp,
} from "./event-watch.ts";

interface FixtureEvent {
  id: string;
  type: string;
  source: string;
  severity: string;
  message: string;
  metadata?: Record<string, unknown>;
  time?: string;
}

function indexFixtureEvent(db: ReturnType<typeof createTestDb>, evt: FixtureEvent): void {
  const time = evt.time ?? "2026-08-01T10:00:00.000Z";
  const envelope = {
    schema_version: 1,
    event_id: evt.id,
    source_event_id: null,
    event_time: time,
    ingest_time: time,
    type: evt.type,
    source: evt.source,
    severity: evt.severity,
    privacy: "internal",
    message: evt.message,
    body: {},
    attributes: {},
  };
  const write = appendRawEvent(db, envelope);
  indexRawEvent(
    db,
    {
      event_id: evt.id,
      schema_version: 1,
      source_event_id: null,
      event_type: evt.type,
      event_time: time,
      ingest_time: time,
      severity: evt.severity,
      source: evt.source,
      privacy_tier: "internal",
      message: evt.message,
      metadata: evt.metadata ?? {},
    },
    write,
  );
}

function fixtureDb(): ReturnType<typeof createTestDb> {
  const db = createTestDb();
  indexFixtureEvent(db, {
    id: "evt-1",
    type: "log",
    source: "cli",
    severity: "error",
    message: "first error",
    metadata: { service: "svc-a" },
  });
  indexFixtureEvent(db, {
    id: "evt-2",
    type: "log",
    source: "cli",
    severity: "warn",
    message: "second warn",
    metadata: { service: "svc-b" },
  });
  indexFixtureEvent(db, {
    id: "evt-3",
    type: "metric",
    source: "scanner",
    severity: "info",
    message: "third metric about svc-b",
  });
  indexFixtureEvent(db, {
    id: "evt-4",
    type: "log",
    source: "mcp",
    severity: "info",
    message: "fourth",
    metadata: { service: "svc-a" },
  });
  return db;
}

describe("clampMcpWatchLimit", () => {
  it("clamps to [1, 1000] with a default of 100", () => {
    expect(clampMcpWatchLimit(undefined)).toBe(100);
    expect(clampMcpWatchLimit(0)).toBe(1);
    expect(clampMcpWatchLimit(-7)).toBe(1);
    expect(clampMcpWatchLimit(2.9)).toBe(2);
    expect(clampMcpWatchLimit(5000)).toBe(1000);
    expect(clampMcpWatchLimit(Number.NaN)).toBe(100);
    expect(clampMcpWatchLimit(1)).toBe(1);
    expect(clampMcpWatchLimit(1000)).toBe(1000);
  });
});

describe("matchesEventService", () => {
  it("matches exact metadata.service and falls back to message substring", () => {
    expect(
      matchesEventService(
        { metadata: { service: "svc-a" }, message: "x" },
        "svc-a",
      ),
    ).toBe(true);
    expect(
      matchesEventService(
        { metadata: { service: "svc-a" }, message: "x" },
        "svc-b",
      ),
    ).toBe(false);
    expect(
      matchesEventService({ metadata: null, message: "hello svc-b" }, "svc-b"),
    ).toBe(true);
    expect(
      matchesEventService({ metadata: null, message: "hello" }, "svc-b"),
    ).toBe(false);
  });
});

describe("queryWatchEventRows", () => {
  it("returns all rows ordered by rowid with no filter", () => {
    const db = fixtureDb();
    const rows = queryWatchEventRows(db, {}, 0, undefined, 10);
    expect(rows.map((r) => r.event_id)).toEqual([
      "evt-1",
      "evt-2",
      "evt-3",
      "evt-4",
    ]);
    expect(rows[0]?.metadata).toEqual({ service: "svc-a" });
  });

  it("applies the limit and the after-rowid cursor", () => {
    const db = fixtureDb();
    const first = queryWatchEventRows(db, {}, 0, undefined, 2);
    expect(first.map((r) => r.event_id)).toEqual(["evt-1", "evt-2"]);
    const after = queryWatchEventRows(
      db,
      {},
      first.at(-1)!.rowid,
      undefined,
      10,
    );
    expect(after.map((r) => r.event_id)).toEqual(["evt-3", "evt-4"]);
  });

  it("treats comma-separated list filters as IN clauses with trimming", () => {
    const db = fixtureDb();
    const rows = queryWatchEventRows(
      db,
      { event_type: "log, metric", severity: "error, warn" },
      0,
      undefined,
      10,
    );
    expect(rows.map((r) => r.event_id)).toEqual(["evt-1", "evt-2"]);
  });

  it("applies scalar filters and the since bound", () => {
    const db = fixtureDb();
    const byProject = queryWatchEventRows(
      db,
      { project_id: "missing-project" },
      0,
      undefined,
      10,
    );
    expect(byProject).toHaveLength(0);

    const since = queryWatchEventRows(
      db,
      {},
      0,
      "2026-08-01T10:00:01.000Z",
      10,
    );
    // Only events at/after the since bound (all four share the same
    // timestamp, so none is strictly after; add one later event).
    indexFixtureEvent(db, {
      id: "evt-later",
      type: "log",
      source: "cli",
      severity: "info",
      message: "later",
      time: "2026-08-02T00:00:00.000Z",
    });
    const since2 = queryWatchEventRows(
      db,
      {},
      0,
      "2026-08-02T00:00:00.000Z",
      10,
    );
    expect(since2.map((r) => r.event_id)).toEqual(["evt-later"]);
    expect(since).toHaveLength(0);
  });

  it("matches the service filter on metadata and message without metadata over-match", () => {
    const db = fixtureDb();
    const byMeta = queryWatchEventRows(db, { service: "svc-a" }, 0, undefined, 10);
    expect(byMeta.map((r) => r.event_id)).toEqual(["evt-1", "evt-4"]);

    // The metadata match is exact JSON-field matching, not prefix matching:
    // "svc-a" must not match a service named "svc-ab".
    indexFixtureEvent(db, {
      id: "evt-prefix",
      type: "log",
      source: "cli",
      severity: "info",
      message: "prefix trap",
      metadata: { service: "svc-ab" },
    });
    const strict = queryWatchEventRows(db, { service: "svc-a" }, 0, undefined, 10);
    expect(strict.map((r) => r.event_id)).toEqual(["evt-1", "evt-4"]);

    const byMessage = queryWatchEventRows(db, { service: "svc-b" }, 0, undefined, 10);
    // evt-2 has metadata service svc-b; evt-3 mentions svc-b in its message.
    expect(byMessage.map((r) => r.event_id)).toEqual(["evt-2", "evt-3"]);

    // LIKE metacharacters in the service name must never expand into
    // wildcards on the metadata side. escapeLikeJson renders `%` as `\%`,
    // which SQLite treats as a literal backslash (no ESCAPE clause is
    // declared), so the metadata arm degrades to a strict no-match — a false
    // negative for exotic names, but never a false positive that matches
    // sibling services.
    indexFixtureEvent(db, {
      id: "evt-esc-1",
      type: "log",
      source: "cli",
      severity: "info",
      message: "escaped",
      metadata: { service: "svc%x" },
    });
    indexFixtureEvent(db, {
      id: "evt-esc-2",
      type: "log",
      source: "cli",
      severity: "info",
      message: "escaped",
      metadata: { service: "svc1x" },
    });
    indexFixtureEvent(db, {
      id: "evt-esc-3",
      type: "log",
      source: "cli",
      severity: "info",
      message: "escaped",
      metadata: { service: "svc_x" },
    });
    const escaped = queryWatchEventRows(db, { service: "svc%x" }, 0, undefined, 10);
    expect(escaped.map((r) => r.event_id)).toEqual([]); // no wildcard over-match
    const underscore = queryWatchEventRows(db, { service: "svc_x" }, 0, undefined, 10);
    expect(underscore.map((r) => r.event_id)).toEqual([]); // no wildcard over-match
  });

  it("returns metadata as a parsed object and tolerates malformed metadata", () => {
    const db = fixtureDb();
    const rows = queryWatchEventRows(db, {}, 0, undefined, 10);
    expect(rows[0]?.metadata).toEqual({ service: "svc-a" });
    db.prepare("UPDATE event_records SET metadata = '{not json' WHERE event_id = ?")
      .run("evt-2");
    const again = queryWatchEventRows(db, {}, 0, undefined, 10);
    expect(again[1]?.metadata).toBeNull();
  });
});

describe("latestMatchingEventRowid and rowidForEventId", () => {
  it("returns 0 on an empty catalog and the last matching rowid otherwise", () => {
    const empty = createTestDb();
    expect(latestMatchingEventRowid(empty, {})).toBe(0);

    const db = fixtureDb();
    const all = queryWatchEventRows(db, {}, 0, undefined, 10);
    expect(latestMatchingEventRowid(db, {})).toBe(all.at(-1)!.rowid);
    const errors = queryWatchEventRows(
      db,
      { severity: "error" },
      0,
      undefined,
      10,
    );
    expect(latestMatchingEventRowid(db, { severity: "error" })).toBe(
      errors.at(-1)!.rowid,
    );
  });

  it("resolves rowids by event id and returns null for unknown ids", () => {
    const db = fixtureDb();
    expect(rowidForEventId(db, "evt-1")).toBeGreaterThan(0);
    expect(rowidForEventId(db, "nope")).toBeNull();
  });
});

describe("watchEventsForMcp", () => {
  const baseArgs: McpEventWatchArgs = {};

  it("returns no events and the latest cursor when no anchor and not from_start", () => {
    const db = fixtureDb();
    const result = watchEventsForMcp(db, baseArgs);
    expect(result.events).toHaveLength(0);
    expect(result.cursor).toBe("evt-4");
    expect(result.has_more).toBe(false);
    expect(result.overflow).toBeNull();
  });

  it("returns all events from_start in rowid order", () => {
    const db = fixtureDb();
    const result = watchEventsForMcp(db, { ...baseArgs, from_start: true });
    expect(result.events.map((e) => e.event_id)).toEqual([
      "evt-1",
      "evt-2",
      "evt-3",
      "evt-4",
    ]);
    expect(result.cursor).toBe("evt-4");
  });

  it("reports overflow with a last_event_id_unknown reason", () => {
    const db = fixtureDb();
    const result = watchEventsForMcp(db, {
      ...baseArgs,
      last_event_id: "does-not-exist",
    });
    expect(result.events).toHaveLength(0);
    expect(result.has_more).toBe(false);
    expect(result.overflow).toEqual({
      reason: "last_event_id_unknown",
      last_event_id: "does-not-exist",
    });
    expect(result.cursor).toBe("evt-4");
  });

  it("resumes from a known anchor and pages with has_more", () => {
    const db = fixtureDb();
    const page = watchEventsForMcp(db, {
      ...baseArgs,
      last_event_id: "evt-1",
      limit: 2,
    });
    expect(page.events.map((e) => e.event_id)).toEqual(["evt-2", "evt-3"]);
    expect(page.has_more).toBe(true);
    expect(page.cursor).toBe("evt-3");

    const next = watchEventsForMcp(db, {
      ...baseArgs,
      last_event_id: page.cursor!,
      limit: 2,
    });
    expect(next.events.map((e) => e.event_id)).toEqual(["evt-4"]);
    expect(next.has_more).toBe(false);
  });

  it("applies filters while paging", () => {
    const db = fixtureDb();
    const result = watchEventsForMcp(db, {
      ...baseArgs,
      from_start: true,
      severity: "info",
    });
    expect(result.events.map((e) => e.event_id)).toEqual(["evt-3", "evt-4"]);
  });

  it("excludes internal mcp tool-call events unless include_internal is set", () => {
    const db = fixtureDb();
    indexFixtureEvent(db, {
      id: "evt-internal",
      type: "agent",
      source: "mcp",
      severity: "info",
      message: "tool call",
      metadata: { category: "mcp_tool_call", tool_name: "read" },
    });
    const filtered = watchEventsForMcp(db, { ...baseArgs, from_start: true });
    expect(filtered.events.map((e) => e.event_id)).not.toContain("evt-internal");

    const included = watchEventsForMcp(db, {
      ...baseArgs,
      from_start: true,
      include_internal: true,
    });
    expect(included.events.map((e) => e.event_id)).toContain("evt-internal");
  });

  it("applies the service filter client-side-safe over the SQL layer", () => {
    const db = fixtureDb();
    const result = watchEventsForMcp(db, {
      ...baseArgs,
      from_start: true,
      service: "svc-a",
    });
    expect(result.events.map((e) => e.event_id)).toEqual(["evt-1", "evt-4"]);
  });

  it("uses the anchor's own event id as the resume cursor", () => {
    const db = fixtureDb();
    const result = watchEventsForMcp(db, {
      ...baseArgs,
      last_event_id: "evt-4",
    });
    expect(result.events).toHaveLength(0);
    expect(result.cursor).toBe("evt-4");
    expect(result.has_more).toBe(false);
  });
});
