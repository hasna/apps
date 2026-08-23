process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, resetDatabase } from "../db/database.js";
import { hookRegistry } from "./hooks.js";
import {
  reloadWebhooks,
  makeWebhookHandler,
} from "./built-in-hooks.js";

/**
 * SSRF regression: webhook handler_url is caller-supplied and the delivery
 * path POSTs the full hook context (including complete Memory objects) from
 * the serve/MCP process. A poisoned DB row (pre-fix, or written past the
 * persistence chokepoint) must never produce an outbound POST.
 */

const originalFetch = globalThis.fetch;

function insertPoisonedWebhook(db: ReturnType<typeof getDatabase>, url: string, id = "poisoned-row", type = "PostMemoryUpdate"): void {
  db.run(
    `INSERT INTO webhook_hooks
       (id, type, handler_url, priority, blocking, enabled, created_at, invocation_count, failure_count)
     VALUES (?, ?, ?, ?, 0, 1, ?, 0, 0)`,
    [id, type, url, 50, "2026-08-22T00:00:00Z"]
  );
}

describe("webhook delivery fails closed on disallowed handler URLs", () => {
  let fetchCalls: number;

  beforeEach(() => {
    resetDatabase();
    fetchCalls = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      fetchCalls++;
      return new Response("unexpected outbound POST", { status: 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("loadWebhooksFromDb skips rows whose handler URL is loopback/private", () => {
    const db = getDatabase();
    insertPoisonedWebhook(db, "http://169.254.169.254/latest/meta-data/", "poisoned-meta");
    insertPoisonedWebhook(db, "http://127.0.0.1:43129/capture", "poisoned-loopback", "PostMemorySave");

    reloadWebhooks();

    const webhookHooks = hookRegistry
      .list()
      .filter((h) => h.description?.startsWith("Webhook: "));
    expect(webhookHooks.some((h) => h.description === "Webhook: http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(webhookHooks.some((h) => h.description === "Webhook: http://127.0.0.1:43129/capture")).toBe(false);
    expect(fetchCalls).toBe(0);
  });

  it("firing a hook with a blocked URL performs no outbound POST", async () => {
    const db = getDatabase();
    insertPoisonedWebhook(db, "http://127.0.0.1:43129/capture");

    reloadWebhooks();
    await hookRegistry.runHooks("PostMemoryUpdate", {
      memoryId: "m1",
      input: {},
      existing: { id: "m1" },
      agentId: "a",
      projectId: "p",
      sessionId: "s",
      timestamp: Date.now(),
    } as never);
    // Non-blocking hooks fire async; let the microtask queue settle.
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchCalls).toBe(0);
  });

  it("makeWebhookHandler fails closed when handed a disallowed URL directly", async () => {
    const handler = makeWebhookHandler("test-id", "http://169.254.169.254/latest/meta-data/iam/security-credentials/");
    await handler({ agentId: "a", memory: { id: "m1", value: "secret" } });

    expect(fetchCalls).toBe(0);
  });

  it("a valid public URL is still delivered", async () => {
    let receivedBody: string | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls++;
      receivedBody = String(init?.body ?? "");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const handler = makeWebhookHandler("valid-id", "https://example.com/hook");
    await handler({ agentId: "a" });

    expect(fetchCalls).toBe(1);
    expect(receivedBody).not.toBeNull();
    expect(JSON.parse(receivedBody!)).toEqual({ agentId: "a" });
  });
});
