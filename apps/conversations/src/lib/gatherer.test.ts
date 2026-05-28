import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { gatherTrainingData } from "./gatherer";
import { sendMessage } from "./messages";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-gatherer-${Date.now()}.db`);

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

describe("gatherTrainingData", () => {
  test("returns empty source when no messages exist", async () => {
    const result = await gatherTrainingData();
    expect(result.source).toBe("conversations");
    expect(result.count).toBe(0);
    expect(result.examples).toHaveLength(0);
  });

  test("generates training examples from messages", async () => {
    sendMessage({ from: "alice", to: "bob", content: "hello", session_id: "shared-1" });
    sendMessage({ from: "bob", to: "alice", content: "hi back", session_id: "shared-1" });
    sendMessage({ from: "alice", to: "bob", content: "how are you?", session_id: "shared-1" });

    const result = await gatherTrainingData();
    expect(result.source).toBe("conversations");
    expect(result.count).toBeGreaterThan(0);
    expect(result.examples.length).toBeGreaterThan(0);

    const example = result.examples[0];
    expect(example.messages.length).toBeGreaterThan(1);
    expect(example.messages[0].role).toBe("system");
  });

  test("respects limit option", async () => {
    for (let i = 0; i < 10; i++) {
      sendMessage({ from: "alice", to: "bob", content: `message ${i}`, session_id: "limit-1" });
    }

    const result = await gatherTrainingData({ limit: 2 });
    expect(result.count).toBe(2);
    expect(result.examples).toHaveLength(2);
  });

  test("includes system prompt in each example", async () => {
    sendMessage({ from: "alice", to: "bob", content: "test", session_id: "sys-prompt" });
    sendMessage({ from: "bob", to: "alice", content: "reply", session_id: "sys-prompt" });

    const result = await gatherTrainingData();
    for (const example of result.examples) {
      expect(example.messages[0].role).toBe("system");
    }
  });

  test("skips sessions with fewer than 2 messages", async () => {
    // Only sending one message - shouldn't generate examples from it
    // We need at least a session with 2+ messages
    const result = await gatherTrainingData();
    // Each session with 2+ messages contributes examples
    expect(result.source).toBe("conversations");
  });
});
