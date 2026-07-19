import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { extractTopics, getChannelTopics, getSessionTopics, getTrendingTopics } from "./topics";
import { sendMessage } from "./messages";
import { createChannel, joinChannel } from "./channels";
import { closeDb } from "./db";
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

  test("does not derive topics from secrets, restricted channels, or content beyond the collection scan bound", () => {
    createChannel("safe-topics", "tester");
    createChannel("security-incidents", "tester");
    sendMessage({
      from: "a",
      to: "safe-topics",
      channel: "safe-topics",
      content: `deployment Bearer abcdefghijklmnopqrstuvwxyz123456 ${"padding ".repeat(700)} tailtopic ${"tailtopic ".repeat(20)}`,
    });
    sendMessage({
      from: "a",
      to: "security-incidents",
      channel: "security-incidents",
      content: "restrictedbody restrictedbody restrictedbody",
    });

    const safeWords = getChannelTopics("safe-topics").map((topic) => topic.topic);
    expect(safeWords.join(" ")).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(safeWords).not.toContain("tailtopic");
    expect(getChannelTopics("security-incidents")).toEqual([]);
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
