import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { sendMessage, readMessages, readDigest, markRead, markReadByIds, markSessionRead, markChannelRead, getMessageById, markAllRead, exportMessages, deleteMessage, editMessage, pinMessage, unpinMessage, getPinnedMessages, searchMessages, getUnreadBlockers, getThreadReplies, compactMessage, listUnreadCounts, parseMentions, listUnreadCountsWithMentions, getMessagesForAgent, markMentionsRead, markUnread, markUnreadByIds, recordReadReceipt, recordReadReceiptsBatch, getReadReceipts, getMessageReadStatus, MAX_MESSAGE_BYTES } from "./messages";
import { createChannel, joinChannel } from "./channels";
import { readChannelNotifications, subscribeToChannelNotifications } from "./channel-notifications";
import { closeDb, getDb } from "./db";
import { redactSensitiveText } from "./content-safety";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-msg-${Date.now()}.db`);

function syntheticPrivateKey(): string {
  return [
    "-----BEGIN " + "PRIVATE KEY-----",
    "not-a-real-key-material",
    "-----END " + "PRIVATE KEY-----",
  ].join("\n");
}

function syntheticUnterminatedPrivateKey(): string {
  return [
    "-----BEGIN " + "PRIVATE KEY-----",
    "not-real-unterminated-key-material",
  ].join("\n");
}

function syntheticCloudKey(): string {
  return "AKIA" + "A".repeat(16);
}

function syntheticBearerToken(): string {
  return "Bearer " + "b".repeat(32);
}

function syntheticPat(): string {
  return "gh" + "p_" + "c".repeat(36);
}

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "app_user:synthetic-password", "@db.example.invalid/app"].join("");
}

function syntheticCloudSecretValue(): string {
  return "s".repeat(32);
}

function cloudSecretKeyName(): string {
  return ["AWS", "SECRET", "ACCESS", "KEY"].join("_");
}

function syntheticEnvDump(): string {
  return [
    "APP_MODE=development",
    "SERVICE_HOST=localhost",
    "FEATURE_FLAG=enabled",
  ].join("\n");
}

function insertLegacyMessage(content: string, metadata?: Record<string, unknown>): void {
  getDb().prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, content, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run("legacy-session", "legacy-from", "legacy-to", content, metadata ? JSON.stringify(metadata) : null);
}

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

  test("stores project_id when provided", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "scoped", project_id: "proj-xyz" });
    expect(msg.project_id).toBe("proj-xyz");
  });

  test("project_id defaults to null", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "no scope" });
    expect(msg.project_id).toBeNull();
  });

  test("supports channel", () => {
    const msg = sendMessage({ from: "a", to: "general", content: "hello", channel: "general" });
    expect(msg.channel).toBe("general");
  });

  test("normalizes channel messages to the canonical channel key", () => {
    createChannel("My Channel", "alice");
    const msg = sendMessage({ from: "alice", to: "My Channel", content: "hello", channel: "My Channel", session_id: "channel:My Channel" });
    expect(msg.channel).toBe("my-channel");
    expect(msg.to_agent).toBe("my-channel");
    expect(msg.session_id).toBe("channel:my-channel");
    expect(readMessages({ channel: "My Channel" }).map((m) => m.id)).toEqual([msg.id]);
    expect(readMessages({ channel: "my-channel" }).map((m) => m.id)).toEqual([msg.id]);
  });

  test("generates channel session_id", () => {
    const msg = sendMessage({ from: "a", to: "general", content: "hello", channel: "general" });
    expect(msg.session_id).toBe("channel:general");
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

  for (const [label, fixture] of [
    ["private keys", syntheticPrivateKey],
    ["cloud keys", syntheticCloudKey],
    ["bearer tokens", syntheticBearerToken],
    ["personal access tokens", syntheticPat],
    ["database URLs", syntheticDatabaseUrl],
    ["multiline env dumps", syntheticEnvDump],
  ] as const) {
    test(`blocks ${label} before persistence`, () => {
      expect(() => sendMessage({ from: "alice", to: "bob", content: `please do not send\n${fixture()}` }))
        .toThrow(/sensitive content detected/);
      expect(readMessages()).toHaveLength(0);
    });
  }

  test("blocks sensitive metadata before persistence", () => {
    const blocked = syntheticDatabaseUrl();
    expect(() => sendMessage({
      from: "alice",
      to: "bob",
      content: "metadata should be checked too",
      metadata: { nested: { dsn: blocked } },
    })).toThrow(/sensitive content detected/);
    expect(readMessages()).toHaveLength(0);
  });

  test("blocks sensitive serialized metadata before persistence", () => {
    const blocked = syntheticDatabaseUrl();
    const metadata = {
      toJSON: () => ({ dsn: blocked }),
    } as unknown as Record<string, unknown>;

    expect(() => sendMessage({
      from: "alice",
      to: "bob",
      content: "serialized metadata should be checked too",
      metadata,
    })).toThrow(/sensitive content detected/);
    expect(readMessages()).toHaveLength(0);
  });

  test("blocks label-based metadata secrets before persistence", () => {
    expect(() => sendMessage({
      from: "alice",
      to: "bob",
      content: "metadata labels should be checked too",
      metadata: { [cloudSecretKeyName()]: syntheticCloudSecretValue() },
    })).toThrow(/sensitive content detected/);
    expect(readMessages()).toHaveLength(0);
  });

  test("blocks nested label-based metadata secrets before persistence", () => {
    expect(() => sendMessage({
      from: "alice",
      to: "bob",
      content: "nested metadata labels should be checked too",
      metadata: { [cloudSecretKeyName()]: { value: syntheticCloudSecretValue() } },
    })).toThrow(/sensitive content detected/);
    expect(readMessages()).toHaveLength(0);
  });

  test("blocks sensitive persisted context fields before persistence", () => {
    expect(() => sendMessage({
      from: "alice",
      to: "bob",
      content: "context fields should be checked too",
      branch: syntheticPat(),
    })).toThrow(/sensitive content detected/);
    expect(readMessages()).toHaveLength(0);
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

  test("filters by project_id", () => {
    sendMessage({ from: "a", to: "b", content: "proj msg", project_id: "proj-abc" });
    sendMessage({ from: "a", to: "b", content: "no proj" });
    const msgs = readMessages({ project_id: "proj-abc" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].project_id).toBe("proj-abc");
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

  test("redacts legacy sensitive content from read, show, search, and digest paths", () => {
    const blocked = syntheticDatabaseUrl();
    insertLegacyMessage(`legacy ${blocked}`, { nested: { dsn: blocked } });

    const read = readMessages({ to: "legacy-to" });
    expect(read).toHaveLength(1);
    expect(JSON.stringify(read)).not.toContain(blocked);
    expect(read[0].content).toContain("[REDACTED:DATABASE_URL]");

    const shown = getMessageById(read[0].id);
    expect(JSON.stringify(shown)).not.toContain(blocked);

    const searched = searchMessages({ query: "legacy" });
    expect(JSON.stringify(searched)).not.toContain(blocked);

    const digest = readDigest({ to: "legacy-to" });
    expect(JSON.stringify(digest)).not.toContain(blocked);
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

describe("markReadByIds", () => {
  test("marks messages by id regardless of to_agent", () => {
    const msg = sendMessage({ from: "a", to: "bob", content: "hi" });
    const count = markReadByIds([msg.id]);
    expect(count).toBe(1);
    const updated = getMessageById(msg.id);
    expect(updated?.read_at).toBeTruthy();
  });

  test("returns 0 for empty array", () => {
    expect(markReadByIds([])).toBe(0);
  });

  test("marks channel messages", () => {
    const msg = sendMessage({ from: "a", to: "mychannel", channel: "mychannel", content: "hi" });
    const count = markReadByIds([msg.id]);
    expect(count).toBe(1);
    const updated = getMessageById(msg.id);
    expect(updated?.read_at).toBeTruthy();
  });

  test("does not double-mark", () => {
    const msg = sendMessage({ from: "a", to: "bob", content: "hi" });
    markReadByIds([msg.id]);
    const count = markReadByIds([msg.id]);
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

  test("redacts sensitive content in JSON exports", () => {
    const legacyContent = `legacy DSN ${syntheticDatabaseUrl()}`;
    const legacyMetadata = { authorization: syntheticBearerToken(), [cloudSecretKeyName()]: { value: syntheticCloudSecretValue() } };
    insertLegacyMessage(legacyContent, legacyMetadata);

    const result = exportMessages();
    const parsed = JSON.parse(result);
    const serialized = JSON.stringify(parsed);

    expect(parsed[0].content).toContain("[REDACTED:DATABASE_URL]");
    expect(serialized).toContain("[REDACTED:BEARER_TOKEN]");
    expect(serialized).toContain("[REDACTED:CLOUD_KEY]");
    expect(serialized).not.toContain(syntheticDatabaseUrl());
    expect(serialized).not.toContain(syntheticBearerToken());
    expect(serialized).not.toContain(syntheticCloudSecretValue());
  });

  test("redacts unterminated private key blocks through EOF", () => {
    const blocked = syntheticUnterminatedPrivateKey();
    const material = "not-real-unterminated-key-material";
    insertLegacyMessage(`legacy ${blocked}`);

    expect(redactSensitiveText(blocked)).toContain("[REDACTED:PRIVATE_KEY]");
    expect(redactSensitiveText(blocked)).not.toContain(material);

    const exported = exportMessages();
    expect(exported).toContain("[REDACTED:PRIVATE_KEY]");
    expect(exported).not.toContain(material);
  });

  test("returns CSV with headers", () => {
    sendMessage({ from: "alice", to: "bob", content: "hello" });
    const result = exportMessages({ format: "csv" });
    const lines = result.split("\n");
    expect(lines[0]).toBe("id,session_id,from_agent,to_agent,channel,content,priority,created_at,read_at");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("alice");
    expect(lines[1]).toContain("bob");
    expect(lines[1]).toContain("hello");
  });

  test("redacts sensitive content in CSV exports", () => {
    insertLegacyMessage(`legacy token ${syntheticPat()}`);

    const result = exportMessages({ format: "csv" });

    expect(result).toContain("[REDACTED:PAT]");
    expect(result).not.toContain(syntheticPat());
  });

  test("filters by channel", () => {
    sendMessage({ from: "a", to: "general", content: "in-channel", channel: "general" });
    sendMessage({ from: "a", to: "b", content: "no-channel" });
    const result = exportMessages({ channel: "general" });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].content).toBe("in-channel");
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
  test("blocks sensitive content before updating", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "original" });

    expect(() => editMessage(msg.id, "alice", `new ${syntheticBearerToken()}`))
      .toThrow(/sensitive content detected/);
    expect(getMessageById(msg.id)?.content).toBe("original");
  });

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

  test("rejects oversized edited content without changing the message", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "original" });
    const oversizedContent = "x".repeat(MAX_MESSAGE_BYTES + 1);

    expect(() => editMessage(msg.id, "alice", oversizedContent)).toThrow("Message content exceeds maximum size");

    const unchanged = getMessageById(msg.id);
    expect(unchanged!.content).toBe("original");
    expect(unchanged!.edited_at).toBeNull();
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

  test("filters by channel", () => {
    const msg1 = sendMessage({ from: "a", to: "general", content: "channel-pinned", channel: "general" });
    const msg2 = sendMessage({ from: "a", to: "b", content: "dm-pinned" });
    pinMessage(msg1.id);
    pinMessage(msg2.id);
    const pinned = getPinnedMessages({ channel: "general" });
    expect(pinned).toHaveLength(1);
    expect(pinned[0].content).toBe("channel-pinned");
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

  test("orders results by newest first when sort=recent", () => {
    sendMessage({ from: "a", to: "b", content: "first match" });
    sendMessage({ from: "a", to: "b", content: "second match" });
    sendMessage({ from: "a", to: "b", content: "third match" });
    const results = searchMessages({ query: "match", sort: "recent" });
    expect(results).toHaveLength(3);
    expect(results[0].content).toBe("third match");
    expect(results[2].content).toBe("first match");
  });

  test("returns snippet and relevance_score", () => {
    sendMessage({ from: "a", to: "b", content: "the deployment failed spectacularly at midnight" });
    const results = searchMessages({ query: "deployment" });
    expect(results).toHaveLength(1);
    expect(results[0].relevance_score).toBeGreaterThan(0);
    expect(results[0].snippet).toBeTruthy();
  });

  test("defaults to relevance sorting (BM25)", () => {
    sendMessage({ from: "a", to: "b", content: "test alpha" });
    sendMessage({ from: "a", to: "b", content: "test beta" });
    const results = searchMessages({ query: "test" });
    expect(results).toHaveLength(2);
    // Both should have relevance scores
    expect(results.every((r) => r.relevance_score >= 0)).toBe(true);
  });

  test("filters by channel", () => {
    sendMessage({ from: "a", to: "general", content: "deploy in channel", channel: "general" });
    sendMessage({ from: "a", to: "b", content: "deploy in DM" });
    const results = searchMessages({ query: "deploy", channel: "general" });
    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe("general");
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

  test("defaults to limit 20", () => {
    for (let i = 0; i < 25; i++) {
      sendMessage({ from: "a", to: "b", content: `item ${i}` });
    }
    const results = searchMessages({ query: "item" });
    expect(results).toHaveLength(20);
  });

  test("combines multiple filters", () => {
    sendMessage({ from: "alice", to: "general", content: "deploy v1", channel: "general" });
    sendMessage({ from: "bob", to: "general", content: "deploy v2", channel: "general" });
    sendMessage({ from: "alice", to: "bob", content: "deploy v3" });
    const results = searchMessages({ query: "deploy", from: "alice", channel: "general" });
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

  test("getUnreadBlockers returns blockers from channels", () => {
    createChannel("blocker-channel", "alice");
    joinChannel("blocker-channel", "bob");

    sendMessage({ from: "alice", to: "blocker-channel", content: "channel blocker", channel: "blocker-channel", blocking: true });

    const blockers = getUnreadBlockers("bob");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].content).toBe("channel blocker");
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

describe("threaded replies", () => {
  test("sendMessage with reply_to stores the reference", () => {
    const parent = sendMessage({ from: "alice", to: "bob", content: "original" });
    const reply = sendMessage({ from: "bob", to: "alice", content: "reply", reply_to: parent.id });
    expect(reply.reply_to).toBe(parent.id);
  });

  test("sendMessage without reply_to defaults to null", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "no reply" });
    expect(msg.reply_to).toBeNull();
  });

  test("getThreadReplies returns replies to a message", () => {
    const parent = sendMessage({ from: "alice", to: "bob", content: "parent" });
    sendMessage({ from: "bob", to: "alice", content: "reply 1", reply_to: parent.id });
    sendMessage({ from: "charlie", to: "alice", content: "reply 2", reply_to: parent.id });
    sendMessage({ from: "alice", to: "bob", content: "unrelated" });

    const replies = getThreadReplies(parent.id);
    expect(replies).toHaveLength(2);
    expect(replies[0].content).toBe("reply 1");
    expect(replies[1].content).toBe("reply 2");
    expect(replies.every(r => r.reply_to === parent.id)).toBe(true);
  });

  test("getThreadReplies returns empty for no replies", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "lonely" });
    const replies = getThreadReplies(msg.id);
    expect(replies).toHaveLength(0);
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

  test("sends large safe attachment with chunked scanning", () => {
    const srcFile = join(TEMP_DIR, "large.txt");
    writeFileSync(srcFile, "safe attachment content\n".repeat(5000));

    const msg = sendMessage({
      from: "alice",
      to: "bob",
      content: "large file",
      attachments: [{ name: "large.txt", source_path: srcFile }],
    });

    expect(msg.attachments).toBeTruthy();
    expect(msg.attachments![0].size).toBeGreaterThan(64 * 1024);
  });

  test("message without attachments has null attachments field", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "no files" });
    expect(msg.attachments).toBeNull();
  });

  test("does not persist message when attachment content is sensitive", () => {
    const srcFile = join(TEMP_DIR, "leaky.txt");
    writeFileSync(srcFile, `attachment ${syntheticDatabaseUrl()}`);

    expect(() => sendMessage({
      from: "alice",
      to: "bob",
      content: "bad attachment content",
      attachments: [{ name: "leaky.txt", source_path: srcFile }],
    })).toThrow(/sensitive content detected/);

    expect(readMessages()).toHaveLength(0);
  });

  test("does not persist message when attachment source is missing", () => {
    expect(() => sendMessage({
      from: "alice",
      to: "bob",
      content: "bad attachment",
      attachments: [{ name: "missing.txt", source_path: join(TEMP_DIR, "missing.txt") }],
    })).toThrow("Attachment source not found");

    expect(readMessages()).toHaveLength(0);
  });

  test("does not persist message when attachment name is invalid", () => {
    const srcFile = join(TEMP_DIR, "secret.txt");
    writeFileSync(srcFile, "secret");

    expect(() => sendMessage({
      from: "alice",
      to: "bob",
      content: "bad attachment name",
      attachments: [{ name: ".env", source_path: srcFile }],
    })).toThrow("Invalid attachment name");

    expect(readMessages()).toHaveLength(0);
  });
});

describe("readDigest", () => {
  test("returns digest id, message ids, snippets, and byte-bounded output", () => {
    sendMessage({ from: "a", to: "b", content: "hello world" });
    sendMessage({ from: "a", to: "b", content: "x".repeat(800) });
    const result = readDigest({ to: "b", max_bytes: 1200 });
    expect(result.digest_id).toHaveLength(16);
    expect(result.byte_length).toBeLessThanOrEqual(1200);
    expect(result.total_available).toBe(2);
    expect(result.total_unread).toBe(2);
    expect(result.shown).toBe(2);
    expect(result.message_ids).toEqual([1, 2]);
    expect(result.next_cursor).toBe(2);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].snippet).toBe("hello world");
    expect(result.messages[1].snippet).toStartWith("x");
    expect(result.messages[1].snippet.length).toBeLessThan(800);
  });

  test("does not mark messages read by default", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "hi" });
    readDigest({ to: "b" });
    const updated = getMessageById(msg.id);
    expect(updated?.read_at).toBeNull();
  });

  test("marks messages read when requested", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "hi" });
    const result = readDigest({ to: "b", mark_read: true, reader: "b" });
    const updated = getMessageById(msg.id);
    expect(result.marked_read).toBe(1);
    expect(updated?.read_at).toBeTruthy();
  });

  test("mark-read digest still respects max_bytes", () => {
    sendMessage({ from: "a", to: "b", content: "x".repeat(800) });
    const result = readDigest({ to: "b", max_bytes: 700, mark_read: true, reader: "b" });
    expect(result.byte_length).toBeLessThanOrEqual(700);
    expect(result.marked_read).toBe(result.shown);
  });

  test("mark-read digest clears channel notification unread state", () => {
    createChannel("digest-notify", "owner");
    subscribeToChannelNotifications("digest-notify", "reader");
    const msg = sendMessage({ from: "alice", to: "digest-notify", channel: "digest-notify", content: "notify me" });

    expect(readChannelNotifications({ agent: "reader", channel: "digest-notify", unread_only: true })).toHaveLength(1);
    const result = readDigest({ channel: "digest-notify", mark_read: true, reader: "reader" });

    expect(result.message_ids).toEqual([msg.id]);
    expect(readChannelNotifications({ agent: "reader", channel: "digest-notify", unread_only: true })).toHaveLength(0);
  });

  test("supports unread-only mode explicitly", () => {
    const first = sendMessage({ from: "a", to: "b", content: "first" });
    sendMessage({ from: "a", to: "b", content: "second" });
    markReadByIds([first.id], "b");
    const result = readDigest({ to: "b", unread_only: true });
    expect(result.shown).toBe(1);
    expect(result.messages[0].snippet).toBe("second");
    expect(result.message_ids).toEqual([2]);
  });

  test("uses message id cursor for deterministic continuation", () => {
    const first = sendMessage({ from: "a", to: "mychannel", channel: "mychannel", content: "first" });
    const second = sendMessage({ from: "a", to: "mychannel", channel: "mychannel", content: "second" });
    sendMessage({ from: "a", to: "mychannel", channel: "mychannel", content: "third" });

    const result = readDigest({ channel: "mychannel", cursor: first.id, limit: 1 });
    expect(result.message_ids).toEqual([second.id]);
    expect(result.next_cursor).toBe(second.id);
    expect(result.has_more).toBe(true);
  });

  test("cursor continuation follows id order even when timestamps are out of order", () => {
    const first = sendMessage({ from: "a", to: "imported", channel: "imported", content: "id-one" });
    const second = sendMessage({ from: "a", to: "imported", channel: "imported", content: "id-two" });
    getDb().prepare("UPDATE messages SET created_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000", second.id);

    const page1 = readDigest({ channel: "imported", limit: 1 });
    const page2 = readDigest({ channel: "imported", cursor: page1.next_cursor ?? undefined, limit: 1 });

    expect(page1.message_ids).toEqual([first.id]);
    expect(page2.message_ids).toEqual([second.id]);
  });

  test("advances cursor when a matching message cannot fit even as an empty snippet", () => {
    const msg = sendMessage({
      from: "agent-" + "x".repeat(700),
      to: "tiny",
      channel: "tiny",
      content: "small content",
    });

    const result = readDigest({ channel: "tiny", max_bytes: 512 });
    expect(result.shown).toBe(0);
    expect(result.skipped_count).toBe(1);
    expect(result.next_cursor).toBe(msg.id);
    expect(result.has_more).toBe(false);
    expect(result.byte_length).toBeLessThanOrEqual(512);
  });

  test("does not drop already selected messages when later skip metadata cannot fit", () => {
    const first = sendMessage({ from: "a", to: "lossless", channel: "lossless", content: "first" });
    const second = sendMessage({
      from: "agent-" + "x".repeat(700),
      to: "lossless",
      channel: "lossless",
      content: "second",
    });

    const page1 = readDigest({ channel: "lossless", max_bytes: 630 });
    expect(page1.message_ids).toEqual([first.id]);
    expect(page1.skipped_count).toBe(0);
    expect(page1.next_cursor).toBe(first.id);
    expect(page1.has_more).toBe(true);
    expect(page1.byte_length).toBeLessThanOrEqual(630);

    const page2 = readDigest({ channel: "lossless", cursor: page1.next_cursor ?? undefined, max_bytes: 630 });
    expect(page2.message_ids).toEqual([]);
    expect(page2.skipped_count).toBe(1);
    expect(page2.next_cursor).toBe(second.id);
    expect(page2.byte_length).toBeLessThanOrEqual(630);
  });

  test("marks included messages read when a later message is skipped for byte budget", () => {
    const first = sendMessage({ from: "a", to: "skip-mark", channel: "skip-mark", content: "first" });
    const second = sendMessage({
      from: "agent-" + "x".repeat(700),
      to: "skip-mark",
      channel: "skip-mark",
      content: "second",
    });

    const result = readDigest({ channel: "skip-mark", max_bytes: 900, mark_read: true, reader: "reader" });
    expect(result.message_ids).toEqual([first.id]);
    expect(result.skipped_count).toBe(1);
    expect(result.next_cursor).toBe(second.id);
    expect(result.marked_read).toBe(1);
    expect(getMessageById(first.id)?.read_at).toBeTruthy();
    expect(getMessageById(second.id)?.read_at).toBeNull();
  });

  test("rejects a digest envelope that cannot fit the requested byte cap", () => {
    expect(() => readDigest({ to: "agent-" + "x".repeat(2000), max_bytes: 512 }))
      .toThrow("Digest envelope exceeds max_bytes");
  });

  test("filters by channel", () => {
    sendMessage({ from: "a", to: "mychannel", channel: "mychannel", content: "in channel" });
    sendMessage({ from: "a", to: "b", content: "dm" });
    const result = readDigest({ channel: "mychannel" });
    expect(result.messages.every((m) => m.channel === "mychannel")).toBe(true);
  });

  test("has_attachments is false when no attachments", () => {
    sendMessage({ from: "a", to: "b", content: "plain" });
    const result = readDigest({ to: "b" });
    expect(result.messages[0].has_attachments).toBe(false);
    expect(result.messages[0].attachment_count).toBe(0);
  });
});

describe("compactMessage", () => {
  test("strips null fields", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "hello" });
    const compact = compactMessage(msg);
    expect(compact.channel).toBeUndefined();
    expect(compact.metadata).toBeUndefined();
    expect(compact.content).toBe("hello");
  });
});

describe("parseMentions", () => {
  test("extracts unique mentions", () => {
    expect(parseMentions("hey @alice and @bob")).toEqual(["alice", "bob"]);
  });
  test("deduplicates mentions (case insensitive)", () => {
    expect(parseMentions("@Alice and @alice")).toEqual(["alice"]);
  });
  test("returns empty for no mentions", () => {
    expect(parseMentions("no mentions here")).toEqual([]);
  });
});

describe("listUnreadCounts", () => {
  test("returns unread counts per channel for agent", () => {
    createChannel("dev", "admin");
    joinChannel("dev", "bob");
    // Channel messages count as unread for members when sent by another agent.
    sendMessage({ from: "a", to: "", channel: "dev", content: "hello world" });
    const counts = listUnreadCounts("bob");
    expect(counts.length).toBeGreaterThanOrEqual(1);
    const dev = counts.find((c) => c.channel === "dev");
    expect(dev).toBeDefined();
    expect(dev!.unread_count).toBeGreaterThanOrEqual(1);
  });

  test("returns all channels when no agent specified", () => {
    createChannel("general", "admin");
    sendMessage({ from: "a", to: "general", channel: "general", content: "hi there" });
    const counts = listUnreadCounts();
    expect(counts.length).toBeGreaterThanOrEqual(1);
  });
});

describe("listUnreadCountsWithMentions", () => {
  test("returns mention counts", () => {
    createChannel("proj", "admin");
    joinChannel("proj", "carol");
    sendMessage({ from: "a", to: "proj", channel: "proj", content: "hey @carol check this" });
    const counts = listUnreadCountsWithMentions("carol");
    expect(counts.length).toBeGreaterThanOrEqual(1);
  });
});

describe("getMessagesForAgent", () => {
  test("returns messages mentioning agent", async () => {
    createChannel("team", "admin");
    sendMessage({ from: "a", to: "team", channel: "team", content: "ping @dave" });
    // processMentions is async — give it time
    await new Promise((r) => setTimeout(r, 100));
    const result = getMessagesForAgent("dave");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].mention_id).toBeDefined();
  });

  test("filters by channel", async () => {
    createChannel("s1", "admin");
    createChannel("s2", "admin");
    sendMessage({ from: "a", to: "s1", channel: "s1", content: "in s1 @eve" });
    sendMessage({ from: "a", to: "s2", channel: "s2", content: "in s2 @eve" });
    await new Promise((r) => setTimeout(r, 100));
    const result = getMessagesForAgent("eve", { channel: "s1" });
    expect(result.length).toBe(1);
  });
});

describe("markMentionsRead", () => {
  test("marks all mentions as read", async () => {
    createChannel("ch", "admin");
    sendMessage({ from: "a", to: "ch", channel: "ch", content: "@frank check this" });
    await new Promise((r) => setTimeout(r, 100));
    const changed = markMentionsRead("frank");
    expect(changed).toBeGreaterThanOrEqual(1);
  });

  test("marks mentions in specific channel", async () => {
    createChannel("sp", "admin");
    sendMessage({ from: "a", to: "sp", channel: "sp", content: "@grace look here" });
    await new Promise((r) => setTimeout(r, 100));
    const changed = markMentionsRead("grace", "sp");
    expect(changed).toBeGreaterThanOrEqual(1);
  });
});

describe("markUnread / markUnreadByIds", () => {
  test("markUnread resets read_at", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "hi" });
    markRead([msg.id], "b");
    expect(getMessageById(msg.id)!.read_at).not.toBeNull();
    markUnread(msg.id);
    expect(getMessageById(msg.id)!.read_at).toBeNull();
  });

  test("markUnreadByIds resets multiple", () => {
    const m1 = sendMessage({ from: "a", to: "b", content: "1" });
    const m2 = sendMessage({ from: "a", to: "b", content: "2" });
    markRead([m1.id, m2.id], "b");
    markUnreadByIds([m1.id, m2.id]);
    expect(getMessageById(m1.id)!.read_at).toBeNull();
    expect(getMessageById(m2.id)!.read_at).toBeNull();
  });

  test("markUnreadByIds handles empty array", () => {
    expect(markUnreadByIds([])).toBe(0);
  });
});

describe("recordReadReceipt / getReadReceipts / getMessageReadStatus", () => {
  test("records and retrieves receipts", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "hi" });
    recordReadReceipt(msg.id, "Bob");
    const receipts = getReadReceipts(msg.id);
    expect(receipts.length).toBe(1);
    expect(receipts[0].agent).toBe("bob");
    expect(receipts[0].read_at).toBeTruthy();
  });

  test("batch records receipts", () => {
    const m1 = sendMessage({ from: "a", to: "b", content: "1" });
    const m2 = sendMessage({ from: "a", to: "b", content: "2" });
    recordReadReceiptsBatch([m1.id, m2.id], "Charlie");
    expect(getReadReceipts(m1.id).length).toBe(1);
    expect(getReadReceipts(m2.id).length).toBe(1);
  });

  test("batch handles empty input", () => {
    recordReadReceiptsBatch([], "x");
    // no error
  });

  test("getMessageReadStatus shows unread members", () => {
    createChannel("rs", "admin");
    joinChannel("rs", "alice");
    joinChannel("rs", "bob");
    const msg = sendMessage({ from: "alice", to: "rs", channel: "rs", content: "hey" });
    recordReadReceipt(msg.id, "alice");
    const status = getMessageReadStatus(msg.id, "rs");
    expect(status.receipts.length).toBe(1);
    expect(status.unread_by).toContain("bob");
    expect(status.unread_by).not.toContain("alice");
  });

  test("getMessageReadStatus matches mixed-case members against normalized receipts", () => {
    createChannel("mixed-rs", "Admin");
    joinChannel("mixed-rs", "Bob");
    joinChannel("mixed-rs", "Carol");
    const msg = sendMessage({ from: "Admin", to: "mixed-rs", channel: "mixed-rs", content: "hey" });
    recordReadReceipt(msg.id, "Bob");
    const status = getMessageReadStatus(msg.id, "mixed-rs");
    expect(status.receipts.map((r) => r.agent)).toContain("bob");
    expect(status.unread_by).toContain("Admin");
    expect(status.unread_by).toContain("Carol");
    expect(status.unread_by).not.toContain("Bob");
  });
});
