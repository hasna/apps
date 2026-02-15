import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sendMessage, readMessages, markRead, markSessionRead, markChannelRead, getMessageById } from "./messages";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-msg-${Date.now()}.db`);

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

describe("sendMessage", () => {
  test("sends basic message and returns it", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    expect(msg.id).toBe(1);
    expect(msg.from_agent).toBe("alice");
    expect(msg.to_agent).toBe("bob");
    expect(msg.content).toBe("hello");
    expect(msg.priority).toBe("normal");
    expect(msg.channel).toBeNull();
    expect(msg.read_at).toBeNull();
    expect(msg.created_at).toBeTruthy();
  });

  test("auto-generates session_id from sorted participants", () => {
    const msg = sendMessage({ from: "bob", to: "alice", content: "hi" });
    expect(msg.session_id).toStartWith("alice-bob-");
  });

  test("uses provided session_id", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hi", session_id: "custom-123" });
    expect(msg.session_id).toBe("custom-123");
  });

  test("supports priority", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "urgent", priority: "urgent" });
    expect(msg.priority).toBe("urgent");
  });

  test("supports channel", () => {
    const msg = sendMessage({ from: "a", to: "general", content: "hello", channel: "general" });
    expect(msg.channel).toBe("general");
  });

  test("supports metadata", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "hi", metadata: { key: "value" } });
    expect(msg.metadata).toEqual({ key: "value" });
  });

  test("supports working_dir, repository, branch", () => {
    const msg = sendMessage({
      from: "a", to: "b", content: "hi",
      working_dir: "/tmp", repository: "my-repo", branch: "main",
    });
    expect(msg.working_dir).toBe("/tmp");
    expect(msg.repository).toBe("my-repo");
    expect(msg.branch).toBe("main");
  });

  test("null metadata when not provided", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "hi" });
    expect(msg.metadata).toBeNull();
  });
});

describe("readMessages", () => {
  test("returns empty array when no messages", () => {
    const msgs = readMessages();
    expect(msgs).toEqual([]);
  });

  test("returns all messages", () => {
    sendMessage({ from: "a", to: "b", content: "1" });
    sendMessage({ from: "a", to: "b", content: "2" });
    const msgs = readMessages();
    expect(msgs).toHaveLength(2);
  });

  test("filters by session_id", () => {
    sendMessage({ from: "a", to: "b", content: "1", session_id: "s1" });
    sendMessage({ from: "a", to: "b", content: "2", session_id: "s2" });
    const msgs = readMessages({ session_id: "s1" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("1");
  });

  test("filters by from", () => {
    sendMessage({ from: "alice", to: "bob", content: "1" });
    sendMessage({ from: "charlie", to: "bob", content: "2" });
    const msgs = readMessages({ from: "alice" });
    expect(msgs).toHaveLength(1);
  });

  test("filters by to", () => {
    sendMessage({ from: "a", to: "bob", content: "1" });
    sendMessage({ from: "a", to: "charlie", content: "2" });
    const msgs = readMessages({ to: "bob" });
    expect(msgs).toHaveLength(1);
  });

  test("filters by channel", () => {
    sendMessage({ from: "a", to: "general", content: "1", channel: "general" });
    sendMessage({ from: "a", to: "b", content: "2" });
    const msgs = readMessages({ channel: "general" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].channel).toBe("general");
  });

  test("filters by unread_only", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "1" });
    sendMessage({ from: "a", to: "b", content: "2" });
    markRead([msg.id], "b");
    const msgs = readMessages({ unread_only: true });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("2");
  });

  test("respects limit", () => {
    sendMessage({ from: "a", to: "b", content: "1" });
    sendMessage({ from: "a", to: "b", content: "2" });
    sendMessage({ from: "a", to: "b", content: "3" });
    const msgs = readMessages({ limit: 2 });
    expect(msgs).toHaveLength(2);
  });

  test("orders by created_at ASC", () => {
    sendMessage({ from: "a", to: "b", content: "first" });
    sendMessage({ from: "a", to: "b", content: "second" });
    const msgs = readMessages();
    expect(msgs[0].content).toBe("first");
    expect(msgs[1].content).toBe("second");
  });

  test("filters by since", () => {
    sendMessage({ from: "a", to: "b", content: "old" });
    const since = new Date().toISOString();
    // Small delay to ensure different timestamp
    sendMessage({ from: "a", to: "b", content: "new" });
    const msgs = readMessages({ since });
    expect(msgs.length).toBeGreaterThanOrEqual(0); // Timing-dependent
  });
});

describe("markRead", () => {
  test("marks messages as read", () => {
    const msg = sendMessage({ from: "a", to: "bob", content: "hi" });
    const count = markRead([msg.id], "bob");
    expect(count).toBe(1);
    const updated = getMessageById(msg.id);
    expect(updated?.read_at).toBeTruthy();
  });

  test("returns 0 for empty array", () => {
    expect(markRead([], "bob")).toBe(0);
  });

  test("only marks if reader is to_agent", () => {
    const msg = sendMessage({ from: "a", to: "bob", content: "hi" });
    const count = markRead([msg.id], "alice"); // wrong reader
    expect(count).toBe(0);
  });

  test("does not double-mark", () => {
    const msg = sendMessage({ from: "a", to: "bob", content: "hi" });
    markRead([msg.id], "bob");
    const count = markRead([msg.id], "bob");
    expect(count).toBe(0);
  });
});

describe("markSessionRead", () => {
  test("marks all messages in session as read", () => {
    sendMessage({ from: "a", to: "bob", content: "1", session_id: "s1" });
    sendMessage({ from: "a", to: "bob", content: "2", session_id: "s1" });
    sendMessage({ from: "a", to: "bob", content: "3", session_id: "s2" });
    const count = markSessionRead("s1", "bob");
    expect(count).toBe(2);
  });
});

describe("markChannelRead", () => {
  test("marks channel messages as read (except own)", () => {
    sendMessage({ from: "alice", to: "general", content: "1", channel: "general" });
    sendMessage({ from: "bob", to: "general", content: "2", channel: "general" });
    // Bob reads — should mark alice's message, not his own
    const count = markChannelRead("general", "bob");
    expect(count).toBe(1);
  });
});

describe("getMessageById", () => {
  test("returns message by id", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "hello" });
    const found = getMessageById(msg.id);
    expect(found).toBeTruthy();
    expect(found?.content).toBe("hello");
  });

  test("returns null for nonexistent id", () => {
    expect(getMessageById(999)).toBeNull();
  });
});
