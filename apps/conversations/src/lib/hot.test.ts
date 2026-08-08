import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { computeHotness, listHotSessions } from "./hot";
import { sendMessage } from "./messages";
import { addReaction } from "./reactions";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-test-hot-${Date.now()}.db`);

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  restoreStoreEnv();
});

describe("computeHotness", () => {
  test("returns null for nonexistent session", () => {
    expect(computeHotness("nonexistent")).toBeNull();
  });

  test("computes basic hotness for a session", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const hot = computeHotness(msg.session_id);
    expect(hot).toBeTruthy();
    expect(hot!.session_id).toBe(msg.session_id);
    expect(hot!.participants).toContain("alice");
    expect(hot!.message_count).toBe(1);
    expect(hot!.hotness_score).toBeGreaterThan(0);
  });

  test("higher score for more recent messages", () => {
    const msg1 = sendMessage({ from: "a", to: "b", content: "active", session_id: "active-sess" });
    sendMessage({ from: "b", to: "a", content: "reply", session_id: "active-sess" });
    sendMessage({ from: "a", to: "b", content: "more", session_id: "active-sess" });
    const hot = computeHotness("active-sess");
    expect(hot!.metrics.msgs_last_1h).toBe(3);
    expect(hot!.metrics.unique_agents).toBe(2);
  });

  test("boosts score for high priority messages", () => {
    sendMessage({ from: "a", to: "b", content: "normal", session_id: "normal-sess" });
    const normalHot = computeHotness("normal-sess");

    sendMessage({ from: "a", to: "b", content: "urgent!", session_id: "urgent-sess", priority: "urgent" });
    const urgentHot = computeHotness("urgent-sess");

    expect(urgentHot!.hotness_score).toBeGreaterThan(normalHot!.hotness_score);
  });

  test("boosts score for blocking messages", () => {
    sendMessage({ from: "a", to: "b", content: "normal", session_id: "no-block" });
    const noBlock = computeHotness("no-block");

    sendMessage({ from: "a", to: "b", content: "BLOCKER", session_id: "has-block", blocking: true });
    const hasBlock = computeHotness("has-block");

    expect(hasBlock!.hotness_score).toBeGreaterThan(noBlock!.hotness_score);
  });

  test("boosts score for reactions", () => {
    const msg1 = sendMessage({ from: "a", to: "b", content: "boring", session_id: "no-react" });
    const noReact = computeHotness("no-react");

    const msg2 = sendMessage({ from: "a", to: "b", content: "exciting", session_id: "has-react" });
    addReaction(msg2.id, "c", "🔥");
    addReaction(msg2.id, "d", "👍");
    const hasReact = computeHotness("has-react");

    expect(hasReact!.hotness_score).toBeGreaterThan(noReact!.hotness_score);
  });

  test("includes reply count in metrics", () => {
    const parent = sendMessage({ from: "a", to: "b", content: "parent", session_id: "thread-sess" });
    sendMessage({ from: "b", to: "a", content: "reply 1", session_id: "thread-sess", reply_to: parent.id, reply_to_uuid: parent.uuid });
    sendMessage({ from: "a", to: "b", content: "reply 2", session_id: "thread-sess", reply_to: parent.id, reply_to_uuid: parent.uuid });
    const hot = computeHotness("thread-sess");
    expect(hot!.metrics.reply_count).toBe(2);
  });
});

describe("listHotSessions", () => {
  test("returns empty array when no messages", () => {
    expect(listHotSessions()).toEqual([]);
  });

  test("returns sessions sorted by hotness", () => {
    sendMessage({ from: "a", to: "b", content: "quiet", session_id: "quiet-sess" });
    sendMessage({ from: "a", to: "b", content: "busy1", session_id: "busy-sess" });
    sendMessage({ from: "b", to: "a", content: "busy2", session_id: "busy-sess" });
    sendMessage({ from: "c", to: "a", content: "busy3", session_id: "busy-sess" });

    const results = listHotSessions();
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].session_id).toBe("busy-sess");
  });

  test("respects limit", () => {
    sendMessage({ from: "a", to: "b", content: "s1", session_id: "s1" });
    sendMessage({ from: "a", to: "c", content: "s2", session_id: "s2" });
    sendMessage({ from: "a", to: "d", content: "s3", session_id: "s3" });
    const results = listHotSessions({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  test("filters by min_score", () => {
    sendMessage({ from: "a", to: "b", content: "low activity", session_id: "low-sess" });
    const results = listHotSessions({ min_score: 9999 });
    expect(results).toHaveLength(0);
  });
});
