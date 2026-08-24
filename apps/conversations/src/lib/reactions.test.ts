import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  addReaction,
  toggleReaction,
  removeReaction,
  getReactions,
  getReactionSummary,
  getReactionSummariesForMessages,
  MessageNotFoundError,
  normalizeEmoji,
} from "./reactions";
import { sendMessage, getMessageById, readMessagePreviews, readDigest } from "./messages";
import { closeDb, getDb } from "./db";
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

describe("addReaction is a Slack-style toggle", () => {
  test("first add returns toggled=added with the row", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const result = addReaction(msg.id, "bob", "👍");
    expect(result.toggled).toBe("added");
    expect(result.reaction).not.toBeNull();
    expect(result.reaction!.id).toBeGreaterThan(0);
    expect(result.reaction!.message_id).toBe(msg.id);
    expect(result.reaction!.agent).toBe("bob");
    expect(result.reaction!.emoji).toBe("👍");
    expect(result.reaction!.created_at).toBeTruthy();
  });

  test("same actor re-adding the same emoji REMOVES it (toggle)", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const r1 = addReaction(msg.id, "bob", "👍");
    expect(r1.toggled).toBe("added");
    const r2 = addReaction(msg.id, "bob", "👍");
    expect(r2.toggled).toBe("removed");
    expect(r2.reaction).toBeNull();
    const all = getReactions(msg.id);
    expect(all.length).toBe(0);
  });

  test("toggleReaction is the same operation as addReaction", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const r1 = toggleReaction(msg.id, "bob", "👍");
    expect(r1.toggled).toBe("added");
    const r2 = toggleReaction(msg.id, "bob", "👍");
    expect(r2.toggled).toBe("removed");
  });

  test("different agents can react with the same emoji without removing each other", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    addReaction(msg.id, "charlie", "👍");
    const all = getReactions(msg.id);
    expect(all.length).toBe(2);
    // Toggling bob's reaction only removes bob's row.
    const toggled = addReaction(msg.id, "bob", "👍");
    expect(toggled.toggled).toBe("removed");
    const remaining = getReactions(msg.id);
    expect(remaining.length).toBe(1);
    expect(remaining[0].agent).toBe("charlie");
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

describe("removeReaction (agent-driven cleanup, idempotent)", () => {
  test("removes an existing reaction", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    const removed = removeReaction(msg.id, "bob", "👍");
    expect(removed).toBe(true);
    const all = getReactions(msg.id);
    expect(all.length).toBe(0);
  });

  test("returns false when reaction does not exist (no error)", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const removed = removeReaction(msg.id, "bob", "👍");
    expect(removed).toBe(false);
  });

  test("does not remove another actor's reaction", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    const removed = removeReaction(msg.id, "charlie", "👍");
    expect(removed).toBe(false);
    expect(getReactions(msg.id).length).toBe(1);
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

describe("NFKC normalization", () => {
  test("normalizeEmoji applies NFKC", () => {
    // U+00E9 (é precomposed) and U+0065 U+0301 (e + combining acute) are
    // NFKC-equivalent. The store must store the normalized form so the two
    // spellings dedupe to one row.
    const composed = "é";
    const decomposed = "é";
    expect(normalizeEmoji(composed)).toBe(normalizeEmoji(decomposed));
  });

  test("NFKC-equivalent spellings dedupe to a single row and toggle", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const composed = "é";   // é
    const decomposed = "é"; // é (decomposed)
    const r1 = addReaction(msg.id, "bob", composed);
    expect(r1.toggled).toBe("added");
    expect(r1.reaction!.emoji).toBe(composed.normalize("NFKC"));
    // Same actor + same emoji after normalization -> toggle removes.
    const r2 = addReaction(msg.id, "bob", decomposed);
    expect(r2.toggled).toBe("removed");
    expect(getReactions(msg.id).length).toBe(0);
  });

  test("skin-tone emoji sequences round-trip exactly and are distinct per tone", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const light = "👍🏻"; // U+1F44D U+1F3FB
    const dark = "👍🏿";  // U+1F44D U+1F3FF
    addReaction(msg.id, "bob", light);
    addReaction(msg.id, "bob", dark);
    const reactions = getReactions(msg.id);
    expect(reactions.length).toBe(2);
    expect(reactions.some((r) => r.emoji === light)).toBe(true);
    expect(reactions.some((r) => r.emoji === dark)).toBe(true);
  });
});

describe("getReactionSummariesForMessages (envelope grouped helper)", () => {
  test("returns a map keyed by message id from one grouped query", () => {
    const msg1 = sendMessage({ from: "alice", to: "bob", content: "one" });
    const msg2 = sendMessage({ from: "alice", to: "bob", content: "two" });
    addReaction(msg1.id, "bob", "👍");
    addReaction(msg1.id, "charlie", "👍");
    addReaction(msg2.id, "alice", "❤️");

    const map = getReactionSummariesForMessages([msg1.id, msg2.id]);
    expect(map.size).toBe(2);
    const s1 = map.get(msg1.id)!;
    expect(s1.length).toBe(1);
    expect(s1[0].emoji).toBe("👍");
    expect(s1[0].count).toBe(2);
    expect(map.get(msg2.id)![0].emoji).toBe("❤️");
  });

  test("returns empty map for no ids or no reactions", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "one" });
    expect(getReactionSummariesForMessages([]).size).toBe(0);
    expect(getReactionSummariesForMessages([msg.id]).size).toBe(0);
  });
});

describe("message envelope carries reactions", () => {
  test("getMessageById (show) carries the reactions array", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    addReaction(msg.id, "charlie", "👍");
    const fetched = getMessageById(msg.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.reactions).toBeTruthy();
    expect(fetched!.reactions!.length).toBe(1);
    expect(fetched!.reactions![0].emoji).toBe("👍");
    expect(fetched!.reactions![0].count).toBe(2);
  });

  test("readMessagePreviews (read) carries the reactions array on each preview", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    const page = readMessagePreviews({ id: msg.id });
    expect(page.messages.length).toBe(1);
    expect(page.messages[0].reactions).toBeTruthy();
    expect(page.messages[0].reactions![0].emoji).toBe("👍");
  });

  test("readDigest (digest) carries the reactions array on each digest message", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    const digest = readDigest({ to: "bob" });
    const entry = digest.messages.find((m) => m.id === msg.id);
    expect(entry).toBeTruthy();
    expect(entry!.reactions).toBeTruthy();
    expect(entry!.reactions![0].emoji).toBe("👍");
  });
});

describe("emoji content-safety (P1: credential-shaped emoji is rejected on write and redacted on read)", () => {
  // Synthetic credential-shaped values. They must trip the APP content-safety
  // detector (scanSensitiveContent) but NOT the CI commit-time secret scan
  // patterns (which would block the fixture itself) — see tooling/ci/check-secrets.ts.
  const CREDENTIAL_SHAPED = [
    "xoxp-0123456789abcdefghijklmnopqrstuv", // Slack token shape (cloud_key)
    "glpat-abcdefghijklmnopqrstuvwxyz0123", // GitLab PAT shape
    "github_pat_abcdefghijklmnopqrstuvwxyz", // GitHub fine-grained PAT shape
  ];

  test("credential-shaped emoji is REJECTED on addReaction (assertNoSensitiveContent) and nothing is stored", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    for (const bad of CREDENTIAL_SHAPED) {
      expect(() => addReaction(msg.id, "bob", bad)).toThrow(/sensitive content/i);
    }
    expect(getReactions(msg.id).length).toBe(0);
  });

  test("credential-shaped emoji is REJECTED on toggleReaction (store boundary)", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    expect(() => toggleReaction(msg.id, "bob", "glpat-abcdefghijklmnopqrstuvwxyz0123")).toThrow(/sensitive content/i);
    expect(getReactions(msg.id).length).toBe(0);
  });

  test("real emoji (thumbs-up, skin tone, ZWJ, rocket) survive the write assert and read back unchanged", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    addReaction(msg.id, "bob", "👍");
    addReaction(msg.id, "bob", "👏🏿");
    addReaction(msg.id, "bob", "👩‍💻");
    addReaction(msg.id, "bob", "🚀");
    expect(getReactions(msg.id).map((r) => r.emoji)).toEqual(["👍", "👏🏿", "👩‍💻", "🚀"]);
    expect(getReactionSummary(msg.id).map((s) => s.emoji)).toEqual(["👍", "👏🏿", "👩‍💻", "🚀"]);
  });

  test("a credential-shaped emoji seeded directly into the store is REDACTED on every read surface", () => {
    const msg = sendMessage({ from: "alice", to: "bob", content: "hello" });
    const bad = "glpat-abcdefghijklmnopqrstuvwxyz0123";
    // Bypass the write assert to simulate a malicious emoji that somehow
    // survived: insert the raw row straight into the DB.
    getDb().prepare("INSERT INTO reactions (message_id, agent, emoji) VALUES (?, ?, ?)").run(msg.id, "bob", bad);

    const assertRedacted = (emoji: string | undefined) => {
      expect(emoji).toBeTruthy();
      expect(emoji!).toContain("[REDACTED");
      expect(emoji!).not.toContain(bad);
    };

    // getReactions (raw)
    const raw = getReactions(msg.id);
    expect(raw).toHaveLength(1);
    assertRedacted(raw[0].emoji);

    // getReactionSummary (grouped)
    const summary = getReactionSummary(msg.id);
    expect(summary).toHaveLength(1);
    assertRedacted(summary[0].emoji);

    // getReactionSummariesForMessages (envelope helper)
    const map = getReactionSummariesForMessages([msg.id]);
    assertRedacted(map.get(msg.id)?.[0].emoji);

    // message envelope (show)
    const fetched = getMessageById(msg.id);
    assertRedacted(fetched!.reactions?.[0].emoji);

    // read preview envelope
    const page = readMessagePreviews({ id: msg.id });
    assertRedacted(page.messages[0].reactions?.[0].emoji);

    // digest envelope
    const digest = readDigest({ to: "bob" });
    const entry = digest.messages.find((m) => m.id === msg.id);
    assertRedacted(entry!.reactions?.[0].emoji);
  });
});
