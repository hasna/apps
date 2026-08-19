/**
 * Tests for the session timeline store (src/db/timeline.ts): event
 * recording, JSON details round-trip, newest-first ordering, the limit
 * bound, and per-session clearing.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase } from "./schema.js";
import { createSession } from "./sessions.js";
import { logEvent, getTimeline, clearTimeline } from "./timeline.js";

let tmpDir: string;
let sid1: string;
let sid2: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "timeline-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
  // session_id is FK-constrained to sessions(id)
  sid1 = createSession({ engine: "playwright" }).id;
  sid2 = createSession({ engine: "playwright" }).id;
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("timeline events", () => {
  it("logs an event and reads it back with details intact", () => {
    logEvent(sid1, "navigate", { url: "https://example.com", ok: true });
    const timeline = getTimeline(sid1);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].event_type).toBe("navigate");
    expect(timeline[0].session_id).toBe(sid1);
    expect(JSON.parse(timeline[0].details)).toEqual({ url: "https://example.com", ok: true });
    expect(timeline[0].timestamp).toBeTruthy();
  });

  it("defaults details to an empty object", () => {
    logEvent(sid1, "click");
    const timeline = getTimeline(sid1);
    expect(JSON.parse(timeline[0].details)).toEqual({});
  });

  it("returns events newest-first", () => {
    logEvent(sid1, "first");
    logEvent(sid1, "second");
    logEvent(sid1, "third");
    const timeline = getTimeline(sid1);
    expect(timeline.map(e => e.event_type)).toEqual(["third", "second", "first"]);
  });

  it("honors the limit parameter", () => {
    for (let i = 0; i < 10; i++) logEvent(sid1, `e${i}`);
    const limited = getTimeline(sid1, 3);
    expect(limited).toHaveLength(3);
    expect(limited[0].event_type).toBe("e9");
  });

  it("scopes the timeline to one session", () => {
    logEvent(sid1, "mine");
    logEvent(sid2, "other");
    expect(getTimeline(sid1)).toHaveLength(1);
    expect(getTimeline(sid2)).toHaveLength(1);
  });

  it("clears the timeline for one session only", () => {
    logEvent(sid1, "a");
    logEvent(sid1, "b");
    logEvent(sid2, "c");
    clearTimeline(sid1);
    expect(getTimeline(sid1)).toHaveLength(0);
    expect(getTimeline(sid2)).toHaveLength(1);
  });
});
