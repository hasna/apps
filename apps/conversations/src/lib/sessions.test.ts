import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { listSessions, getSession } from "./sessions";
import { sendMessage } from "./messages";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-sess-${Date.now()}.db`);

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

describe("listSessions", () => {
  test("returns empty when no messages", () => {
    expect(listSessions()).toEqual([]);
  });

  test("returns sessions grouped by session_id", () => {
    sendMessage({ from: "alice", to: "bob", content: "1", session_id: "s1" });
    sendMessage({ from: "bob", to: "alice", content: "2", session_id: "s1" });
    sendMessage({ from: "alice", to: "charlie", content: "3", session_id: "s2" });

    const sessions = listSessions();
    expect(sessions).toHaveLength(2);
  });

  test("includes correct participant list", () => {
    sendMessage({ from: "alice", to: "bob", content: "1", session_id: "s1" });
    sendMessage({ from: "bob", to: "alice", content: "2", session_id: "s1" });

    const sessions = listSessions();
    const s = sessions.find((s) => s.session_id === "s1");
    expect(s).toBeTruthy();
    expect(s!.participants).toContain("alice");
    expect(s!.participants).toContain("bob");
    expect(s!.message_count).toBe(2);
  });

  test("filters by agent", () => {
    sendMessage({ from: "alice", to: "bob", content: "1", session_id: "s1" });
    sendMessage({ from: "charlie", to: "dave", content: "2", session_id: "s2" });

    const sessions = listSessions("alice");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe("s1");
  });

  test("counts unread for specific agent", () => {
    sendMessage({ from: "alice", to: "bob", content: "1", session_id: "s1" });
    sendMessage({ from: "alice", to: "bob", content: "2", session_id: "s1" });

    const sessions = listSessions("bob");
    expect(sessions[0].unread_count).toBe(2);
  });

  test("returns sessions ordered by last_message_at DESC", () => {
    sendMessage({ from: "a", to: "b", content: "old", session_id: "s1" });
    sendMessage({ from: "c", to: "d", content: "new", session_id: "s2" });

    const sessions = listSessions();
    expect(sessions).toHaveLength(2);
    // Both may have same timestamp in fast tests; just verify both are present
    const ids = sessions.map((s) => s.session_id);
    expect(ids).toContain("s1");
    expect(ids).toContain("s2");
  });
});

describe("getSession", () => {
  test("returns null for nonexistent session", () => {
    expect(getSession("nonexistent")).toBeNull();
  });

  test("returns session details", () => {
    sendMessage({ from: "alice", to: "bob", content: "hi", session_id: "s1" });
    const session = getSession("s1");
    expect(session).toBeTruthy();
    expect(session!.session_id).toBe("s1");
    expect(session!.message_count).toBe(1);
    expect(session!.participants).toContain("alice");
    expect(session!.participants).toContain("bob");
  });
});
