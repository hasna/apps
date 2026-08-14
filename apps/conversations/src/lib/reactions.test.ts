import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { addReaction, removeReaction, getReactions, getReactionSummary, MessageNotFoundError } from "./reactions";
import { sendMessage } from "./messages";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-reactions-${Date.now()}.db`);

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

describe("addReaction", () => {
  test("adds a reaction to a message", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const reaction = addReaction(msg.id, "bob", "👍");
    expect(reaction.id).toBeGreaterThan(0);
    expect(reaction.message_id).toBe(msg.id);
    expect(reaction.agent).toBe("bob");
    expect(reaction.emoji).toBe("👍");
    expect(reaction.created_at).toBeTruthy();
  });

  test("duplicate reaction (same agent+emoji) is idempotent", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const r1 = addReaction(msg.id, "bob", "👍");
    const r2 = addReaction(msg.id, "bob", "👍");
    expect(r1.id).toBe(r2.id);
    const all = getReactions(msg.id);
    expect(all.length).toBe(1);
  });

  test("different agents can react with same emoji", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    addReaction(msg.id, "charlie", "👍");
    const all = getReactions(msg.id);
    expect(all.length).toBe(2);
  });

  test("same agent can react with different emojis", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    addReaction(msg.id, "bob", "❤️");
    const all = getReactions(msg.id);
    expect(all.length).toBe(2);
  });

  test("throws MessageNotFoundError for a nonexistent message (no orphan row)", () => {
    // Regression: reacting on a nonexistent message must fail cleanly with a
    // not-found error instead of leaking a raw DB error (HTTP 500) or silently
    // inserting an orphan reaction row.
    expect(() => addReaction(999999999, "bob", "🚀")).toThrow(MessageNotFoundError);
    expect(() => addReaction(999999999, "bob", "🚀")).toThrow("Message #999999999 not found.");
    expect(getReactions(999999999).length).toBe(0);
  });
});

describe("removeReaction", () => {
  test("removes an existing reaction", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    const removed = removeReaction(msg.id, "bob", "👍");
    expect(removed).toBe(true);
    const all = getReactions(msg.id);
    expect(all.length).toBe(0);
  });

  test("returns false when reaction does not exist", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const removed = removeReaction(msg.id, "bob", "👍");
    expect(removed).toBe(false);
  });
});

describe("getReactions", () => {
  test("returns all reactions for a message", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    addReaction(msg.id, "charlie", "❤️");
    addReaction(msg.id, "alice", "👍");
    const reactions = getReactions(msg.id);
    expect(reactions.length).toBe(3);
  });

  test("returns empty array for message with no reactions", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const reactions = getReactions(msg.id);
    expect(reactions.length).toBe(0);
  });
});

describe("getReactionSummary", () => {
  test("returns grouped summary by emoji", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    addReaction(msg.id, "charlie", "👍");
    addReaction(msg.id, "alice", "❤️");

    const summary = getReactionSummary(msg.id);
    expect(summary.length).toBe(2);

    const thumbsUp = summary.find((s) => s.emoji === "👍");
    expect(thumbsUp).toBeTruthy();
    expect(thumbsUp!.count).toBe(2);
    expect(thumbsUp!.agents).toContain("bob");
    expect(thumbsUp!.agents).toContain("charlie");

    const heart = summary.find((s) => s.emoji === "❤️");
    expect(heart).toBeTruthy();
    expect(heart!.count).toBe(1);
    expect(heart!.agents).toContain("alice");
  });

  test("returns empty array for no reactions", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const summary = getReactionSummary(msg.id);
    expect(summary.length).toBe(0);
  });
});
