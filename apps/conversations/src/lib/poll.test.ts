import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { startPolling } from "./poll";
import { sendMessage } from "./messages";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Message } from "../types";

const TEST_DB = join(tmpdir(), `conversations-test-poll-${Date.now()}.db`);

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

describe("startPolling", () => {
  test("returns stop function", () => {
    const { stop } = startPolling({
      interval_ms: 1000,
      on_messages: () => {},
    });
    expect(typeof stop).toBe("function");
    stop();
  });

  test("detects new messages", async () => {
    const received: Message[] = [];

    const { stop } = startPolling({
      to_agent: "bob",
      interval_ms: 50,
      on_messages: (msgs) => received.push(...msgs),
    });

    // Send after polling starts
    sendMessage({ from: "alice", to: "bob", content: "hello" });

    // Wait for poll cycle
    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].content).toBe("hello");
  });

  test("filters by session_id", async () => {
    const received: Message[] = [];

    const { stop } = startPolling({
      session_id: "target-session",
      interval_ms: 50,
      on_messages: (msgs) => received.push(...msgs),
    });

    sendMessage({ from: "a", to: "b", content: "match", session_id: "target-session" });
    sendMessage({ from: "a", to: "b", content: "no-match", session_id: "other" });

    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(received.every((m) => m.session_id === "target-session")).toBe(true);
  });

  test("filters by channel", async () => {
    const received: Message[] = [];

    const { stop } = startPolling({
      channel: "general",
      interval_ms: 50,
      on_messages: (msgs) => received.push(...msgs),
    });

    sendMessage({ from: "a", to: "general", content: "ch-msg", channel: "general" });
    sendMessage({ from: "a", to: "b", content: "dm-msg" });

    await new Promise((r) => setTimeout(r, 200));
    stop();

    expect(received.every((m) => m.channel === "general")).toBe(true);
  });

  test("stop prevents further callbacks", async () => {
    let callCount = 0;

    const { stop } = startPolling({
      interval_ms: 30,
      on_messages: () => { callCount++; },
    });

    stop();
    sendMessage({ from: "a", to: "b", content: "after-stop" });

    await new Promise((r) => setTimeout(r, 150));
    expect(callCount).toBe(0);
  });
});
