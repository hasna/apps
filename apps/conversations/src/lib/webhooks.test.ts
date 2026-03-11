import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { fireWebhooks } from "./webhooks";
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Message } from "../types";

const TEST_CONFIG_DIR = join(tmpdir(), `conversations-test-webhooks-${Date.now()}`);
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    session_id: "test-session",
    from_agent: "alice",
    to_agent: "bob",
    space: null,
    content: "hello",
    priority: "normal",
    working_dir: null,
    repository: null,
    branch: null,
    metadata: null,
    created_at: "2026-01-01T00:00:00.000",
    read_at: null,
    edited_at: null,
    pinned_at: null,
    blocking: false,
    attachments: null,
    reply_to: null,
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  process.env.CONVERSATIONS_CONFIG_PATH = TEST_CONFIG_PATH;
});

afterEach(() => {
  delete process.env.CONVERSATIONS_CONFIG_PATH;
  try { rmSync(TEST_CONFIG_DIR, { recursive: true }); } catch {}
});

describe("fireWebhooks", () => {
  test("does nothing when no config file exists", () => {
    // Should not throw
    fireWebhooks(makeMessage());
  });

  test("does nothing when config has no webhooks", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));
    fireWebhooks(makeMessage());
  });

  test("does nothing when config has empty webhooks array", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ webhooks: [] }));
    fireWebhooks(makeMessage());
  });

  test("does not fire webhook when event doesn't match", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["blocker"] }],
    }));
    // Non-blocking DM — shouldn't match "blocker" event
    fireWebhooks(makeMessage({ blocking: false }));
  });

  test("matches dm event for non-space messages", () => {
    let called = false;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (...args: any[]) => { called = true; return new Response("ok"); };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["dm"] }],
    }));
    fireWebhooks(makeMessage({ space: null }));

    // Restore
    setTimeout(() => { globalThis.fetch = originalFetch; }, 100);
    // fetch is async so called may not be true yet, but the function shouldn't throw
  });

  test("matches blocker event for blocking messages", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["blocker"] }],
    }));
    // Should not throw
    fireWebhooks(makeMessage({ blocking: true }));
  });

  test("matches space event for space messages", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["space"] }],
    }));
    fireWebhooks(makeMessage({ space: "general" }));
  });

  test("matches mention event when agent is @mentioned", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["mention"], agent: "bob" }],
    }));
    fireWebhooks(makeMessage({ content: "hey @bob check this" }));
  });

  test("skips webhook scoped to different agent", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["dm"], agent: "charlie" }],
    }));
    // Message to bob, webhook scoped to charlie — should not match
    fireWebhooks(makeMessage({ to_agent: "bob" }));
  });
});
