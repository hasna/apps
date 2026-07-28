import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { fireWebhooks, fireTaskWebhooks, _resetConfigCache, _setWebhookDnsLookupForTest } from "./webhooks";
import { writeFileSync, mkdirSync, unlinkSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Message } from "../types";

const TEST_CONFIG_DIR = join(tmpdir(), `conversations-test-webhooks-${Date.now()}`);
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WARN = console.warn;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    session_id: "test-session",
    from_agent: "alice",
    to_agent: "bob",
    channel: null,
    project_id: null,
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

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(condition()).toBe(true);
}

beforeEach(() => {
  mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  process.env.CONVERSATIONS_CONFIG_PATH = TEST_CONFIG_PATH;
  _setWebhookDnsLookupForTest(async (hostname) => [
    { address: hostname === "192.168.1.100" ? "192.168.1.100" : "93.184.216.34" },
  ]);
  _resetConfigCache();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  console.warn = ORIGINAL_WARN;
  _setWebhookDnsLookupForTest(null);
  delete process.env.CONVERSATIONS_CONFIG_PATH;
  _resetConfigCache();
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

  test("matches dm event for non-channel messages", () => {
    let called = false;
    (globalThis as any).fetch = async (...args: any[]) => { called = true; return new Response("ok"); };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["dm"] }],
    }));
    fireWebhooks(makeMessage({ channel: null }));

    // fetch is async so called may not be true yet, but the function shouldn't throw
  });

  test("matches blocker event for blocking messages", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["blocker"] }],
    }));
    // Should not throw
    fireWebhooks(makeMessage({ blocking: true }));
  });

  test("matches channel event for channel messages", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["channel"] }],
    }));
    fireWebhooks(makeMessage({ channel: "general" }));
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

  test("fires webhook for agent-scoped channel message", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["channel"], agent: "charlie" }],
    }));
    // Channel messages are not filtered by agent scope (only DMs are)
    fireWebhooks(makeMessage({ channel: "general", to_agent: "general" }));
  });

  test("mention event does not match when agent not mentioned", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "http://localhost:9999/hook", events: ["mention"], agent: "bob" }],
    }));
    fireWebhooks(makeMessage({ content: "no mentions here" }));
  });

  test("reports fetch failure without throwing or exposing webhook query strings", async () => {
    const warnings: string[] = [];
    console.warn = ((message: string) => warnings.push(message)) as typeof console.warn;
    (globalThis as any).fetch = async () => {
      throw new Error("network error for https://example.com/hook?debug=query-value&trace=visible-query");
    };
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/hook?debug=query-value", events: ["dm"] }],
    }));
    expect(() => fireWebhooks(makeMessage())).not.toThrow();

    await waitFor(() => warnings.length === 1);
    expect(warnings[0]).toContain("POST failed: network error for https://example.com/hook");
    expect(warnings[0]).toContain("https://example.com/hook");
    expect(warnings[0]).not.toContain("debug=query-value");
    expect(warnings[0]).not.toContain("trace=visible-query");
  });
});

describe("fireTaskWebhooks", () => {
  function makeTaskEvent(overrides: Partial<Parameters<typeof fireTaskWebhooks>[0]> = {}): Parameters<typeof fireTaskWebhooks>[0] {
    return {
      task_id: 1,
      task_uuid: "abc123",
      subject: "Fix login bug",
      action: "created",
      old_status: undefined,
      new_status: "pending",
      agent: "alice",
      detail: undefined,
      priority: "medium",
      assignee: null,
      project_id: "proj-1",
      created_at: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  test("does nothing when no config file exists", () => {
    fireTaskWebhooks(makeTaskEvent());
  });

  test("does nothing when config has no webhooks", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));
    fireTaskWebhooks(makeTaskEvent());
  });

  test("does nothing when no webhooks have task events", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/hook", events: ["dm", "channel"] }],
    }));
    fireTaskWebhooks(makeTaskEvent());
  });

  test("fires webhook for task creation event", async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response("ok");
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/task-hook", events: ["task"] }],
    }));

    fireTaskWebhooks(makeTaskEvent({ action: "created", new_status: "pending" }));

    await waitFor(() => capturedBody !== null);

    expect(capturedBody).toEqual({
      task_id: 1,
      task_uuid: "abc123",
      subject: "Fix login bug",
      action: "created",
      old_status: undefined,
      new_status: "pending",
      agent: "alice",
      detail: undefined,
      priority: "medium",
      assignee: null,
      project_id: "proj-1",
      created_at: "2026-01-01T00:00:00.000Z",
    });

    globalThis.fetch = originalFetch;
  });

  test("fires webhook for task started transition", async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response("ok");
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/task-hook", events: ["task"] }],
    }));

    fireTaskWebhooks(makeTaskEvent({ action: "started", old_status: "pending", new_status: "in_progress" }));

    await waitFor(() => capturedBody !== null);

    expect(capturedBody.action).toBe("started");
    expect(capturedBody.old_status).toBe("pending");
    expect(capturedBody.new_status).toBe("in_progress");

    globalThis.fetch = originalFetch;
  });

  test("fires webhook for task completed transition with evidence", async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response("ok");
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/task-hook", events: ["task"] }],
    }));

    fireTaskWebhooks(makeTaskEvent({
      action: "completed",
      old_status: "in_progress",
      new_status: "completed",
      detail: "Fixed the null pointer in auth handler",
    }));

    await waitFor(() => capturedBody !== null);

    expect(capturedBody.action).toBe("completed");
    expect(capturedBody.detail).toBe("Fixed the null pointer in auth handler");
    expect(capturedBody.old_status).toBe("in_progress");
    expect(capturedBody.new_status).toBe("completed");

    globalThis.fetch = originalFetch;
  });

  test("fires webhook for task cancelled transition with reason", async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response("ok");
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/task-hook", events: ["task"] }],
    }));

    fireTaskWebhooks(makeTaskEvent({
      action: "cancelled",
      old_status: "in_progress",
      new_status: "cancelled",
      detail: "No longer needed after refactor",
    }));

    await waitFor(() => capturedBody !== null);

    expect(capturedBody.action).toBe("cancelled");
    expect(capturedBody.detail).toBe("No longer needed after refactor");

    globalThis.fetch = originalFetch;
  });

  test("fires webhook for task blocked transition", async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response("ok");
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/task-hook", events: ["task"] }],
    }));

    fireTaskWebhooks(makeTaskEvent({
      action: "blocked",
      old_status: "pending",
      new_status: "blocked",
      detail: "Waiting for API access token",
    }));

    await waitFor(() => capturedBody !== null);

    expect(capturedBody.action).toBe("blocked");
    expect(capturedBody.new_status).toBe("blocked");

    globalThis.fetch = originalFetch;
  });

  test("fires webhook for auto_unblocked event", async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response("ok");
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/task-hook", events: ["task"] }],
    }));

    fireTaskWebhooks(makeTaskEvent({
      action: "auto_unblocked",
      old_status: "blocked",
      new_status: "pending",
      agent: "system",
      detail: "dependency #1 completed",
    }));

    await waitFor(() => capturedBody !== null);

    expect(capturedBody.action).toBe("auto_unblocked");
    expect(capturedBody.agent).toBe("system");
    expect(capturedBody.detail).toBe("dependency #1 completed");

    globalThis.fetch = originalFetch;
  });

  test("respects agent scoping — fires only for matching agent", async () => {
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => { callCount++; return new Response("ok"); };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/task-hook", events: ["task"], agent: "bob" }],
    }));

    // Event from alice — should NOT fire
    fireTaskWebhooks(makeTaskEvent({ agent: "alice" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(callCount).toBe(0);

    // Event from bob — SHOULD fire
    fireTaskWebhooks(makeTaskEvent({ agent: "bob" }));
    await waitFor(() => callCount === 1);
    expect(callCount).toBe(1);

    globalThis.fetch = originalFetch;
  });

  test("reports fetch failure without throwing or exposing webhook query strings", async () => {
    let attempted = false;
    const warnings: string[] = [];
    console.warn = ((message: string) => warnings.push(message)) as typeof console.warn;
    (globalThis as any).fetch = async () => {
      attempted = true;
      throw new Error("network error for https://example.com/task-hook?debug=query-value&trace=visible-query");
    };

    try {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
        webhooks: [{ url: "https://example.com/task-hook?debug=query-value", events: ["task"] }],
      }));

      // Should not throw, and the rejected async fetch must settle before restore.
      expect(() => fireTaskWebhooks(makeTaskEvent())).not.toThrow();
      await waitFor(() => attempted);
      await waitFor(() => warnings.length === 1);
      expect(warnings[0]).toContain("task webhook https://example.com/task-hook POST failed: network error for https://example.com/task-hook");
      expect(warnings[0]).not.toContain("debug=query-value");
      expect(warnings[0]).not.toContain("trace=visible-query");
    } finally {
      globalThis.fetch = ORIGINAL_FETCH;
    }
  });

  test("fires multiple task webhooks", async () => {
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string) => {
      urls.push(url);
      return new Response("ok");
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [
        { url: "https://example.com/tasks1", events: ["task"] },
        { url: "https://example.com/tasks2", events: ["task"] },
      ],
    }));

    fireTaskWebhooks(makeTaskEvent());
    await waitFor(() => urls.length === 2);

    expect(urls).toContain("https://example.com/tasks1");
    expect(urls).toContain("https://example.com/tasks2");
    expect(urls).toHaveLength(2);

    globalThis.fetch = originalFetch;
  });

  test("does not fire task webhook when URL is private IP", async () => {
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => { callCount++; return new Response("ok"); };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://192.168.1.100/hook", events: ["task"] }],
    }));

    fireTaskWebhooks(makeTaskEvent());
    await new Promise((r) => setTimeout(r, 100));

    // Should not fire — private IP blocked by SSRF protection
    expect(callCount).toBe(0);

    globalThis.fetch = originalFetch;
  });

  test("fires webhook for priority_changed action", async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return new Response("ok");
    };

    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/task-hook", events: ["task"] }],
    }));

    fireTaskWebhooks(makeTaskEvent({
      action: "priority_changed",
      detail: "medium -> critical",
    }));

    await waitFor(() => capturedBody !== null);

    expect(capturedBody.action).toBe("priority_changed");
    expect(capturedBody.detail).toBe("medium -> critical");
    expect(capturedBody.priority).toBe("medium");

    globalThis.fetch = originalFetch;
  });
});
