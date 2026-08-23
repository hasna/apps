import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { extractTopics, getChannelTopics, getSessionTopics, getTrendingTopics } from "./topics";
import { sendMessage } from "./messages";
import { createChannel, joinChannel } from "./channels";
import { closeDb, getDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-topics-${Date.now()}.db`);

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

describe("extractTopics", () => {
  test("extracts weighted topics from text", () => {
    const topics = extractTopics("deployment deployment deployment failed failed once");
    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0].topic).toBe("deployment");
    expect(topics[0].count).toBe(3);
    expect(topics[0].weight).toBeGreaterThan(0);
  });

  test("filters stopwords", () => {
    const topics = extractTopics("the deployment is going to the server and the database");
    const words = topics.map((t) => t.topic);
    expect(words).not.toContain("the");
    expect(words).not.toContain("and");
    expect(words).toContain("deployment");
  });

  test("filters short words", () => {
    const topics = extractTopics("a ab abc abcd testing ok");
    const words = topics.map((t) => t.topic);
    expect(words).not.toContain("ab");
    expect(words).toContain("abc");
  });

  test("strips markdown syntax", () => {
    const topics = extractTopics("**bold** `code` [link](url) # heading deployment");
    const words = topics.map((t) => t.topic);
    expect(words).toContain("deployment");
  });

  test("strips URLs", () => {
    const topics = extractTopics("check https://example.com/path deployment status");
    const words = topics.map((t) => t.topic);
    expect(words).not.toContain("https");
    expect(words).toContain("deployment");
  });

  test("respects topN limit", () => {
    const text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const topics = extractTopics(text, 3);
    expect(topics).toHaveLength(3);
  });

  test("returns empty array for empty text", () => {
    expect(extractTopics("")).toEqual([]);
    expect(extractTopics("the and or is")).toEqual([]);
  });
});

describe("getChannelTopics", () => {
  test("extracts topics from channel messages", () => {
    createChannel("deploy-channel", "tester");
    sendMessage({ from: "a", to: "deploy-channel", content: "deployment failed on staging server", channel: "deploy-channel" });
    sendMessage({ from: "b", to: "deploy-channel", content: "deployment succeeded on production server", channel: "deploy-channel" });
    const topics = getChannelTopics("deploy-channel");
    expect(topics.length).toBeGreaterThan(0);
    const words = topics.map((t) => t.topic);
    expect(words).toContain("deployment");
    expect(words).toContain("server");
  });

  test("returns empty for channel with no messages", () => {
    createChannel("empty-channel", "tester");
    expect(getChannelTopics("empty-channel")).toEqual([]);
  });
});

describe("getSessionTopics", () => {
  test("extracts topics from session messages", () => {
    sendMessage({ from: "alice", to: "bob", content: "authentication module needs refactoring", session_id: "auth-sess" });
    sendMessage({ from: "bob", to: "alice", content: "authentication tests are failing too", session_id: "auth-sess" });
    const topics = getSessionTopics("auth-sess");
    const words = topics.map((t) => t.topic);
    expect(words).toContain("authentication");
  });
});

describe("getTrendingTopics", () => {
  test("returns topics from recent messages across all channels", () => {
    sendMessage({ from: "a", to: "b", content: "kubernetes cluster scaling issue" });
    sendMessage({ from: "c", to: "d", content: "kubernetes pods restarting frequently" });
    const topics = getTrendingTopics({ hours: 1 });
    const words = topics.map((t) => t.topic);
    expect(words).toContain("kubernetes");
  });
});

/**
 * G6 — topic derivation is bounded and content-safety redacted.
 *
 * `SELECT content FROM messages` pulled whole bodies into the extractor. No row
 * may contribute past the shared preview scan window, and the corpus passes
 * through `redactSensitiveText` before the extractor sees it. Incident/security
 * rows are read on the same terms as any other row.
 */
describe("G6 topic derivation consumes bounded restricted-safe previews", () => {
  function insertLegacy(content: string, opts: { channel?: string | null; session_id: string }): void {
    getDb().prepare(`
      INSERT INTO messages (session_id, from_agent, to_agent, channel, content)
      VALUES (?, ?, ?, ?, ?)
    `).run(opts.session_id, "topic-from", opts.channel ?? "topic-to", opts.channel ?? null, content);
  }

  test("channel topics ignore content past the preview scan window", () => {
    const beyond = "zzbeyondscantopic";
    createChannel("topic-bounded", "tester");
    insertLegacy(`lead marker ${"filler ".repeat(1200)}${beyond}`, { channel: "topic-bounded", session_id: "channel:topic-bounded" });

    const topics = getChannelTopics("topic-bounded");
    expect(topics.map((topic) => topic.topic)).not.toContain(beyond);
  });

  test("incident and security channels contribute topics like any other channel", () => {
    const term = "restrictedtopicterm";
    createChannel("security-bridge", "tester");
    insertLegacy(`body ${term} ${term} ${term}`, { channel: "security-bridge", session_id: "channel:security-bridge" });

    expect(getChannelTopics("security-bridge").map((t) => t.topic)).toContain(term);
    expect(getTrendingTopics().map((t) => t.topic)).toContain(term);
  });

  test("incident-named sessions contribute topics like any other session", () => {
    const term = "restrictedsessionterm";
    insertLegacy(`body ${term} ${term}`, { channel: null, session_id: "incident-review-session" });

    expect(getSessionTopics("incident-review-session").map((t) => t.topic)).toContain(term);
  });

  // The instrument can pass: ordinary rows still produce ordinary topics.
  test("unrestricted rows still produce topics", () => {
    createChannel("topic-ordinary", "tester");
    insertLegacy("deployment deployment deployment pipeline", { channel: "topic-ordinary", session_id: "channel:topic-ordinary" });
    expect(getChannelTopics("topic-ordinary").map((t) => t.topic)).toContain("deployment");
  });

  test("negative and non-finite limits are rejected before SQLite can treat them as unbounded", () => {
    createChannel("topic-limit-reject", "tester");
    insertLegacy("deploy deploy deploy", { channel: "topic-limit-reject", session_id: "channel:topic-limit-reject" });
    expect(() => getChannelTopics("topic-limit-reject", { limit: -1 })).toThrow();
    expect(() => getSessionTopics("channel:topic-limit-reject", { limit: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => getTrendingTopics({ top_n: Number.POSITIVE_INFINITY })).toThrow();
  });

  test("huge limits are normalized to the shared 1000-row ceiling", () => {
    createChannel("topic-limit-clamp", "tester");
    for (let i = 0; i < 1005; i++) {
      insertLegacy(`deploy topic row ${i}`, { channel: "topic-limit-clamp", session_id: "channel:topic-limit-clamp" });
    }
    const topics = getChannelTopics("topic-limit-clamp", { limit: 50_000 });
    expect(topics.map((topic) => topic.topic)).toContain("deploy");
  }, 15_000);
});
