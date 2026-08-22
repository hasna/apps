/**
 * Tests for the heartbeat store (src/db/heartbeats.ts): recording,
 * latest-first ordering, the list bound, and the age-based cleanup.
 * Timestamps come from SQLite's wall clock (second resolution), so
 * ordering-sensitive tests use real sleeps instead of fake time.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase } from "./schema.js";
import { registerAgent } from "./agents.js";
import { recordHeartbeat, getLastHeartbeat, listHeartbeats, cleanOldHeartbeats } from "./heartbeats.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "heartbeats-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("heartbeats", () => {
  it("records a heartbeat and returns it as the last heartbeat", async () => {
    const agent = registerAgent("agent-1");
    const hb = recordHeartbeat(agent.id, "session-9");
    expect(hb.agent_id).toBe(agent.id);
    expect(hb.session_id).toBe("session-9");
    expect(hb.timestamp).toBeTruthy();
    expect(getLastHeartbeat(agent.id)?.id).toBe(hb.id);
  });

  it("returns the most recent heartbeat first", async () => {
    const agent = registerAgent("agent-1");
    recordHeartbeat(agent.id);
    await sleep(2100); // guarantees a strict 2-second gap (SQLite second resolution)
    const second = recordHeartbeat(agent.id);
    expect(getLastHeartbeat(agent.id)?.id).toBe(second.id);
  });

  it("returns null when no heartbeat exists for an agent", () => {
    expect(getLastHeartbeat("ghost-agent")).toBeNull();
  });

  it("lists heartbeats newest-first with a limit", async () => {
    const agent = registerAgent("agent-2");
    for (let i = 0; i < 5; i++) {
      recordHeartbeat(agent.id);
      await sleep(50);
    }
    const all = listHeartbeats(agent.id, 3);
    expect(all).toHaveLength(3);
    // newest first — timestamps must be non-increasing
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].timestamp >= all[i].timestamp).toBe(true);
    }
    expect(all[0].timestamp >= all[all.length - 1].timestamp).toBe(true);
  });

  it("cleans heartbeats older than the given window and keeps recent ones", async () => {
    const agent = registerAgent("agent-3");
    recordHeartbeat(agent.id); // old
    await sleep(2100); // guarantees hb1 is >= 2s older than hb2
    recordHeartbeat(agent.id); // recent
    const removed = cleanOldHeartbeats(1000); // 1-second window
    expect(removed).toBe(1);
    expect(listHeartbeats(agent.id)).toHaveLength(1);
  });

  it("cleans nothing when all heartbeats are fresh", () => {
    const agent = registerAgent("agent-4");
    recordHeartbeat(agent.id);
    const removed = cleanOldHeartbeats(60 * 60 * 1000);
    expect(removed).toBe(0);
  });
});
