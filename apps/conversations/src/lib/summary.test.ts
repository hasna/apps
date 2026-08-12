import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getConversationSummary } from "./summary";
import { sendMessage, pinMessage } from "./messages";
import { addReaction } from "./reactions";
import { createChannel } from "./channels";
import { closeDb, getDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-summary-${Date.now()}.db`);

function syntheticDatabaseUrl(): string {
  return ["postgres", "://", "summary_user:synthetic-password", "@db.example.invalid/app"].join("");
}

function insertLegacyMessage(content: string, opts?: { session_id?: string; channel?: string; priority?: string; blocking?: boolean; pinned_at?: string }): number {
  const result = getDb().prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, channel, content, priority, blocking, pinned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts?.session_id ?? "legacy-summary",
    "legacy-from",
    opts?.channel ?? "legacy-to",
    opts?.channel ?? null,
    content,
    opts?.priority ?? "normal",
    opts?.blocking ? 1 : 0,
    opts?.pinned_at ?? null,
  );
  return Number(result.lastInsertRowid);
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

describe("getConversationSummary", () => {
  test("returns null for nonexistent session", () => {
    expect(getConversationSummary("nonexistent")).toBeNull();
  });

  test("summarizes a session", () => {
    sendMessage({ from: "alice", to: "bob", content: "Let's discuss the deployment strategy", session_id: "deploy-talk" });
    sendMessage({ from: "bob", to: "alice", content: "I think we should deploy to staging first", session_id: "deploy-talk" });
    sendMessage({ from: "alice", to: "bob", content: "Agreed. Staging deployment starting now", session_id: "deploy-talk" });

    const summary = getConversationSummary("deploy-talk");
    expect(summary).toBeTruthy();
    expect(summary!.session_id).toBe("deploy-talk");
    expect(summary!.participants).toContain("alice");
    expect(summary!.participants).toContain("bob");
    expect(summary!.message_count).toBe(3);
    expect(summary!.topics.length).toBeGreaterThan(0);
    expect(summary!.date_range.first).toBeTruthy();
    expect(summary!.date_range.last).toBeTruthy();
  });

  test("includes high priority messages in key_messages", () => {
    sendMessage({ from: "a", to: "b", content: "normal message", session_id: "priority-test" });
    sendMessage({ from: "a", to: "b", content: "URGENT: server down!", session_id: "priority-test", priority: "urgent" });

    const summary = getConversationSummary("priority-test");
    expect(summary!.key_messages.length).toBeGreaterThan(0);
    expect(summary!.key_messages.some((k) => k.reason === "urgent priority")).toBe(true);
  });

  test("includes pinned messages in key_messages", () => {
    const msg = sendMessage({ from: "a", to: "b", content: "important decision", session_id: "pin-test" });
    pinMessage(msg.id);

    const summary = getConversationSummary("pin-test");
    expect(summary!.key_messages.some((k) => k.reason === "pinned")).toBe(true);
  });

  test("includes blocking messages as unresolved blockers", () => {
    sendMessage({ from: "a", to: "b", content: "you must review this", session_id: "blocker-test", blocking: true });

    const summary = getConversationSummary("blocker-test");
    expect(summary!.unresolved_blockers).toHaveLength(1);
  });

  test("tracks reply count in activity", () => {
    const parent = sendMessage({ from: "a", to: "b", content: "question?", session_id: "reply-test" });
    sendMessage({
      from: "b",
      to: "a",
      content: "answer!",
      session_id: "reply-test",
      reply_to: parent.id,
      reply_to_uuid: parent.uuid,
    });

    const summary = getConversationSummary("reply-test");
    expect(summary!.activity.reply_count).toBe(1);
  });

  test("summarizes a channel by name", () => {
    createChannel("summary-channel", "tester");
    sendMessage({ from: "a", to: "summary-channel", content: "channel message about testing", channel: "summary-channel" });
    sendMessage({ from: "b", to: "summary-channel", content: "more testing discussion", channel: "summary-channel" });

    const summary = getConversationSummary("summary-channel");
    expect(summary).toBeTruthy();
    expect(summary!.message_count).toBe(2);
  });

  test("redacts legacy sensitive content in key messages and blockers", () => {
    const blocked = syntheticDatabaseUrl();
    insertLegacyMessage(`urgent ${blocked}`, { session_id: "legacy-summary", priority: "urgent" });
    insertLegacyMessage(`blocked ${blocked}`, { session_id: "legacy-summary", blocking: true });
    insertLegacyMessage(`pinned ${blocked}`, { session_id: "legacy-summary", pinned_at: new Date().toISOString() });

    const summary = getConversationSummary("legacy-summary");
    const serialized = JSON.stringify(summary);

    expect(serialized).toContain("[REDACTED:DATABASE_URL]");
    expect(serialized).not.toContain(blocked);
  });
});

/**
 * G6 — summary derives from a BOUNDED, RESTRICTED-SAFE preview source.
 *
 * `SELECT * FROM messages` handed this function every whole body in the window
 * and it derived topics from all of them. Two consequences, both live:
 *
 *   - Content past COLLECTION_PREVIEW_SCAN_CHARS still moved the output, so an
 *     attacker could steer a "summary" with a body nobody would ever page to.
 *   - Restricted incident/security rows were summarised on the same terms as
 *     any other row. A topic list IS the body, sampled: a term extracted from a
 *     restricted body is that body leaking one word at a time.
 */
describe("G6 summary consumes bounded restricted-safe previews", () => {
  test("content beyond the preview scan window cannot affect topics", () => {
    const beyond = "zzsentinelbeyondscan";
    insertLegacyMessage(
      `visible marker ${"filler ".repeat(1200)}${beyond}`,
      { session_id: "bounded-summary" },
    );

    const summary = getConversationSummary("bounded-summary");
    expect(summary).toBeTruthy();
    expect(JSON.stringify(summary)).not.toContain(beyond);
    expect(summary!.topics.map((topic) => topic.topic)).not.toContain(beyond);
  });

  test("restricted-scope bodies never reach topics or key messages", () => {
    const secret = "quarantinedincidentterm";
    insertLegacyMessage(`urgent ${secret}`, {
      session_id: "incident-summary",
      channel: "incident-bridge",
      priority: "urgent",
    });

    const summary = getConversationSummary("incident-summary");
    expect(summary).toBeTruthy();
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(secret);
    expect(summary!.topics.map((topic) => topic.topic)).not.toContain(secret);
    // The supported output semantics survive: the row is still counted.
    expect(summary!.message_count).toBe(1);
    expect(summary!.key_messages.length).toBeGreaterThan(0);
  });

  test("key message and blocker snippets stay bounded", () => {
    insertLegacyMessage(`blocking ${"b".repeat(5000)}`, { session_id: "bounded-snippets", blocking: true });
    const summary = getConversationSummary("bounded-snippets");
    for (const key of summary!.key_messages) expect(key.content.length).toBeLessThanOrEqual(200);
    for (const blocker of summary!.unresolved_blockers) expect(blocker.content.length).toBeLessThanOrEqual(200);
  });
});
