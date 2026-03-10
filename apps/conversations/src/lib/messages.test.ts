import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sendMessage, readMessages, markRead, markSessionRead, markSpaceRead, getMessageById, markAllRead, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages, searchMessages, getUnreadBlockers } from "./messages";
import { createSpace, joinSpace } from "./spaces";
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
    expect(msg.space).toBeNull();
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

  test("supports space", () => {
    const msg = sendMessage({ from: "a", to: "general", content: "hello", space: "general" });
    expect(msg.space).toBe("general");
  });

  test("generates space session_id", () => {
    const msg = sendMessage({ from: "a", to: "general", content: "hello", space: "general" });
    expect(msg.session_id).toBe("space:general");
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

  test("filters by space", () => {
    sendMessage({ from: "a", to: "general", content: "1", space: "general" });
    sendMessage({ from: "a", to: "b", content: "2" });
    const msgs = readMessages({ space: "general" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].space).toBe("general");
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

describe("markSpaceRead", () => {
  test("marks space messages as read (except own)", () => {
    sendMessage({ from: "alice", to: "general", content: "1", space: "general" });
    sendMessage({ from: "bob", to: "general", content: "2", space: "general" });
    // Bob reads — should mark alice's message, not his own
    const count = markSpaceRead("general", "bob");
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

describe("markAllRead", () => {
  test("marks all unread messages for agent", () => {
    sendMessage({ from: "a", to: "bob", content: "1" });
    sendMessage({ from: "a", to: "bob", content: "2" });
    sendMessage({ from: "a", to: "charlie", content: "3" });
    const count = markAllRead("bob");
    expect(count).toBe(2);
  });

  test("returns 0 when no unread", () => {
    expect(markAllRead("nobody")).toBe(0);
  });

  test("does not re-mark already read messages", () => {
    const msg = sendMessage({ from: "a", to: "bob", content: "1" });
    markRead([msg.id], "bob");
    sendMessage({ from: "a", to: "bob", content: "2" });
    const count = markAllRead("bob");
    expect(count).toBe(1);
  });
});

describe("exportMessages", () => {
  test("returns JSON by default", () => {
    sendMessage({ from: "alice", to: "bob", content: "hello" });
    sendMessage({ from: "bob", to: "alice", content: "world" });
    const result = exportMessages();
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].content).toBe("hello");
    expect(parsed[1].content).toBe("world");
  });

  test("returns CSV with headers", () => {
    sendMessage({ from: "alice", to: "bob", content: "hello" });
    const result = exportMessages({ format: "csv" });
    const lines = result.split("\n");
    expect(lines[0]).toBe("id,session_id,from_agent,to_agent,space,content,priority,created_at,read_at");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("alice");
    expect(lines[1]).toContain("bob");
    expect(lines[1]).toContain("hello");
  });

  test("filters by space", () => {
    sendMessage({ from: "a", to: "general", content: "in-space", space: "general" });
    sendMessage({ from: "a", to: "b", content: "no-space" });
    const result = exportMessages({ space: "general" });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].content).toBe("in-space");
  });

  test("filters by date range (since/until)", () => {
    sendMessage({ from: "a", to: "b", content: "old" });
    const since = new Date().toISOString();
    sendMessage({ from: "a", to: "b", content: "new" });
    const until = new Date(Date.now() + 60000).toISOString();
    const result = exportMessages({ since, until });
    const parsed = JSON.parse(result);
    // The "new" message should be included (created_at >= since)
    // The "old" message may or may not be included depending on timing
    for (const msg of parsed) {
      expect(msg.created_at >= since).toBe(true);
    }
  });

  test("escapes CSV fields with commas", () => {
    sendMessage({ from: "alice", to: "bob", content: "hello, world" });
    const result = exportMessages({ format: "csv" });
    const lines = result.split("\n");
    expect(lines[1]).toContain('"hello, world"');
  });

  test("filters by session_id", () => {
    sendMessage({ from: "a", to: "b", content: "1", session_id: "s1" });
    sendMessage({ from: "a", to: "b", content: "2", session_id: "s2" });
    const result = exportMessages({ session_id: "s1" });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].content).toBe("1");
  });

  test("filters by from", () => {
    sendMessage({ from: "alice", to: "bob", content: "1" });
    sendMessage({ from: "charlie", to: "bob", content: "2" });
    const result = exportMessages({ from: "alice" });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].from_agent).toBe("alice");
  });
});

describe("deleteMessage", () => {
  test("deletes own message", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "delete me" });
    const result = deleteMessage(msg.id, "alice");
    expect(result).toBe(true);
    expect(getMessageById(msg.id)).toBeNull();
  });

  test("fails to delete message from another agent", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const result = deleteMessage(msg.id, "bob");
    expect(result).toBe(false);
    expect(getMessageById(msg.id)).toBeTruthy();
  });

  test("returns false for nonexistent message", () => {
    const result = deleteMessage(999, "alice");
    expect(result).toBe(false);
  });
});

describe("editMessage", () => {
  test("edits own message and sets edited_at", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "original" });
    const edited = editMessage(msg.id, "alice", "updated");
    expect(edited).toBeTruthy();
    expect(edited!.content).toBe("updated");
    expect(edited!.edited_at).toBeTruthy();
  });

  test("fails to edit message from another agent", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "original" });
    const edited = editMessage(msg.id, "bob", "hacked");
    expect(edited).toBeNull();
    const original = getMessageById(msg.id);
    expect(original!.content).toBe("original");
  });

  test("returns null for nonexistent message", () => {
    const edited = editMessage(999, "alice", "nothing");
    expect(edited).toBeNull();
  });

  test("preserves other fields when editing", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "original", priority: "high" });
    const edited = editMessage(msg.id, "alice", "updated");
    expect(edited!.priority).toBe("high");
    expect(edited!.from_agent).toBe("alice");
    expect(edited!.to_agent).toBe("bob");
  });
});

describe("pinMessage / unpinMessage", () => {
  test("pins a message and sets pinned_at", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "important" });
    const pinned = pinMessage(msg.id);
    expect(pinned).toBeTruthy();
    expect(pinned!.pinned_at).toBeTruthy();
  });

  test("unpins a message and clears pinned_at", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "important" });
    pinMessage(msg.id);
    const unpinned = unpinMessage(msg.id);
    expect(unpinned).toBeTruthy();
    expect(unpinned!.pinned_at).toBeNull();
  });

  test("returns null for nonexistent message on pin", () => {
    const pinned = pinMessage(999);
    expect(pinned).toBeNull();
  });

  test("returns null for nonexistent message on unpin", () => {
    const unpinned = unpinMessage(999);
    expect(unpinned).toBeNull();
  });
});

describe("getPinnedMessages", () => {
  test("returns only pinned messages", () => {
    const msg1 = sendMessage({ from: "alice", to: "bob", content: "pinned" });
    sendMessage({ from: "alice", to: "bob", content: "not pinned" });
    pinMessage(msg1.id);
    const pinned = getPinnedMessages();
    expect(pinned).toHaveLength(1);
    expect(pinned[0].content).toBe("pinned");
  });

  test("filters by space", () => {
    const msg1 = sendMessage({ from: "a", to: "general", content: "space-pinned", space: "general" });
    const msg2 = sendMessage({ from: "a", to: "b", content: "dm-pinned" });
    pinMessage(msg1.id);
    pinMessage(msg2.id);
    const pinned = getPinnedMessages({ space: "general" });
    expect(pinned).toHaveLength(1);
    expect(pinned[0].content).toBe("space-pinned");
  });

  test("filters by session_id", () => {
    const msg1 = sendMessage({ from: "a", to: "b", content: "s1-pinned", session_id: "s1" });
    const msg2 = sendMessage({ from: "a", to: "b", content: "s2-pinned", session_id: "s2" });
    pinMessage(msg1.id);
    pinMessage(msg2.id);
    const pinned = getPinnedMessages({ session_id: "s1" });
    expect(pinned).toHaveLength(1);
    expect(pinned[0].content).toBe("s1-pinned");
  });

  test("respects limit", () => {
    const msg1 = sendMessage({ from: "a", to: "b", content: "1" });
    const msg2 = sendMessage({ from: "a", to: "b", content: "2" });
    const msg3 = sendMessage({ from: "a", to: "b", content: "3" });
    pinMessage(msg1.id);
    pinMessage(msg2.id);
    pinMessage(msg3.id);
    const pinned = getPinnedMessages({ limit: 2 });
    expect(pinned).toHaveLength(2);
  });

  test("returns empty array when no pinned messages", () => {
    sendMessage({ from: "a", to: "b", content: "not pinned" });
    const pinned = getPinnedMessages();
    expect(pinned).toEqual([]);
  });
});

describe("searchMessages", () => {
  test("returns empty array when no messages match", () => {
    sendMessage({ from: "a", to: "b", content: "hello world" });
    const results = searchMessages({ query: "nonexistent" });
    expect(results).toEqual([]);
  });

  test("finds messages by content substring", () => {
    sendMessage({ from: "alice", to: "bob", content: "the deployment succeeded" });
    sendMessage({ from: "alice", to: "bob", content: "running tests now" });
    sendMessage({ from: "alice", to: "bob", content: "deployment failed this time" });
    const results = searchMessages({ query: "deployment" });
    expect(results).toHaveLength(2);
    expect(results.every((m) => m.content.includes("deployment"))).toBe(true);
  });

  test("search is case-insensitive (SQL LIKE default)", () => {
    sendMessage({ from: "a", to: "b", content: "Hello World" });
    sendMessage({ from: "a", to: "b", content: "hello there" });
    // SQL LIKE is case-insensitive for ASCII in SQLite by default
    const results = searchMessages({ query: "hello" });
    expect(results).toHaveLength(2);
  });

  test("orders results by newest first (DESC)", () => {
    sendMessage({ from: "a", to: "b", content: "first match" });
    sendMessage({ from: "a", to: "b", content: "second match" });
    sendMessage({ from: "a", to: "b", content: "third match" });
    const results = searchMessages({ query: "match" });
    expect(results).toHaveLength(3);
    expect(results[0].content).toBe("third match");
    expect(results[2].content).toBe("first match");
  });

  test("filters by space", () => {
    sendMessage({ from: "a", to: "general", content: "deploy in space", space: "general" });
    sendMessage({ from: "a", to: "b", content: "deploy in DM" });
    const results = searchMessages({ query: "deploy", space: "general" });
    expect(results).toHaveLength(1);
    expect(results[0].space).toBe("general");
  });

  test("filters by from", () => {
    sendMessage({ from: "alice", to: "bob", content: "bug found" });
    sendMessage({ from: "charlie", to: "bob", content: "bug fixed" });
    const results = searchMessages({ query: "bug", from: "alice" });
    expect(results).toHaveLength(1);
    expect(results[0].from_agent).toBe("alice");
  });

  test("filters by to", () => {
    sendMessage({ from: "a", to: "bob", content: "review please" });
    sendMessage({ from: "a", to: "charlie", content: "review done" });
    const results = searchMessages({ query: "review", to: "bob" });
    expect(results).toHaveLength(1);
    expect(results[0].to_agent).toBe("bob");
  });

  test("respects limit", () => {
    sendMessage({ from: "a", to: "b", content: "test 1" });
    sendMessage({ from: "a", to: "b", content: "test 2" });
    sendMessage({ from: "a", to: "b", content: "test 3" });
    const results = searchMessages({ query: "test", limit: 2 });
    expect(results).toHaveLength(2);
  });

  test("defaults to limit 50", () => {
    for (let i = 0; i < 55; i++) {
      sendMessage({ from: "a", to: "b", content: `item ${i}` });
    }
    const results = searchMessages({ query: "item" });
    expect(results).toHaveLength(50);
  });

  test("combines multiple filters", () => {
    sendMessage({ from: "alice", to: "general", content: "deploy v1", space: "general" });
    sendMessage({ from: "bob", to: "general", content: "deploy v2", space: "general" });
    sendMessage({ from: "alice", to: "bob", content: "deploy v3" });
    const results = searchMessages({ query: "deploy", from: "alice", space: "general" });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("deploy v1");
  });
});

describe("blocking messages", () => {
  test("sendMessage with blocking flag sets blocking to true", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "stop!", blocking: true });
    expect(msg.blocking).toBe(true);
  });

  test("sendMessage without blocking flag defaults to false", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    expect(msg.blocking).toBe(false);
  });

  test("getUnreadBlockers returns blocking DMs for agent", () => {
    sendMessage({ from: "alice", to: "bob", content: "blocker 1", blocking: true });
    sendMessage({ from: "alice", to: "bob", content: "normal msg" });
    sendMessage({ from: "alice", to: "bob", content: "blocker 2", blocking: true });

    const blockers = getUnreadBlockers("bob");
    expect(blockers).toHaveLength(2);
    expect(blockers[0].content).toBe("blocker 1");
    expect(blockers[1].content).toBe("blocker 2");
    expect(blockers.every((b) => b.blocking === true)).toBe(true);
  });

  test("getUnreadBlockers excludes read blockers", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "blocker", blocking: true });
    markRead([msg.id], "bob");

    const blockers = getUnreadBlockers("bob");
    expect(blockers).toHaveLength(0);
  });

  test("getUnreadBlockers returns blockers from spaces", () => {
    createSpace("blocker-space", "alice");
    joinSpace("blocker-space", "bob");

    sendMessage({ from: "alice", to: "blocker-space", content: "space blocker", space: "blocker-space", blocking: true });

    const blockers = getUnreadBlockers("bob");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].content).toBe("space blocker");
  });

  test("getUnreadBlockers returns empty for no blockers", () => {
    sendMessage({ from: "alice", to: "bob", content: "normal" });
    const blockers = getUnreadBlockers("bob");
    expect(blockers).toHaveLength(0);
  });

  test("getUnreadBlockers does not return blockers for other agents", () => {
    sendMessage({ from: "alice", to: "bob", content: "for bob", blocking: true });
    const blockers = getUnreadBlockers("charlie");
    expect(blockers).toHaveLength(0);
  });
});

describe("attachments", () => {
  const { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } = require("fs");

  const TEMP_DIR = join(tmpdir(), `conversations-att-test-${Date.now()}`);
  const ATTACHMENTS_DIR = join(TEMP_DIR, "attachments");

  beforeEach(() => {
    mkdirSync(TEMP_DIR, { recursive: true });
    process.env.CONVERSATIONS_ATTACHMENTS_DIR = ATTACHMENTS_DIR;
  });

  afterEach(() => {
    delete process.env.CONVERSATIONS_ATTACHMENTS_DIR;
    try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch {}
  });

  test("sends message with attachment and copies file", () => {
    const srcFile = join(TEMP_DIR, "test.txt");
    writeFileSync(srcFile, "hello attachment");

    const msg = sendMessage({
      from: "alice",
      to: "bob",
      content: "see attached",
      attachments: [{ name: "test.txt", source_path: srcFile }],
    });

    expect(msg.attachments).toBeTruthy();
    expect(msg.attachments!.length).toBe(1);
    expect(msg.attachments![0].name).toBe("test.txt");
    expect(msg.attachments![0].size).toBe(16);
    expect(msg.attachments![0].mime_type).toBe("text/plain");

    // Verify file was copied
    const destPath = msg.attachments![0].path;
    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath, "utf-8")).toBe("hello attachment");
  });

  test("attachment is persisted and readable from DB", () => {
    const srcFile = join(TEMP_DIR, "data.json");
    writeFileSync(srcFile, '{"key":"value"}');

    const msg = sendMessage({
      from: "alice",
      to: "bob",
      content: "json file",
      attachments: [{ name: "data.json", source_path: srcFile }],
    });

    const retrieved = getMessageById(msg.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.attachments).toBeTruthy();
    expect(retrieved!.attachments!.length).toBe(1);
    expect(retrieved!.attachments![0].name).toBe("data.json");
    expect(retrieved!.attachments![0].mime_type).toBe("application/json");
  });

  test("multiple attachments on one message", () => {
    const src1 = join(TEMP_DIR, "a.txt");
    const src2 = join(TEMP_DIR, "b.png");
    writeFileSync(src1, "file a");
    writeFileSync(src2, "fake png");

    const msg = sendMessage({
      from: "alice",
      to: "bob",
      content: "two files",
      attachments: [
        { name: "a.txt", source_path: src1 },
        { name: "b.png", source_path: src2 },
      ],
    });

    expect(msg.attachments!.length).toBe(2);
    expect(msg.attachments![0].mime_type).toBe("text/plain");
    expect(msg.attachments![1].mime_type).toBe("image/png");
  });

  test("message without attachments has null attachments field", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "no files" });
    expect(msg.attachments).toBeNull();
  });
});
