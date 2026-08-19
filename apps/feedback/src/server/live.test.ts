// Sol-guided coverage — Priority 4: live server and API edge semantics.
//
// startFeedbackServer is started on an ephemeral port (0), exercised over real
// HTTP, and stopped in `finally` so no test leaks a listener. The
// handler-level tests use Hono-style Request objects against an injected store.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeedbackHandler } from "../api.js";
import { startFeedbackServer } from "./index.js";
import { LocalFeedbackStore } from "../storage.js";
import { VERSION } from "../version.js";
import type { FeedbackListFilter, FeedbackStore } from "../types.js";

const HOST = "127.0.0.1";

function tempStore(): LocalFeedbackStore {
  return new LocalFeedbackStore({ dataDir: mkdtempSync(join(tmpdir(), "feedback-live-")), eventSink: null, taskSink: null });
}

interface LiveServer {
  server: ReturnType<typeof startFeedbackServer>;
  store: LocalFeedbackStore;
}

function startLive(store: LocalFeedbackStore, options: Parameters<typeof startFeedbackServer>[0] = {}): LiveServer {
  const server = startFeedbackServer({ ...options, store });
  return { server, store };
}

describe("startFeedbackServer live", () => {
  test("binds an ephemeral port when asked for 0, answers /health with the exact shape, and stops cleanly", async () => {
    const live = startLive(tempStore(), { port: 0 });
    try {
      expect(live.server.port).toBeGreaterThan(0);
      const health = await fetch(`http://${HOST}:${live.server.port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true, service: "feedback", version: VERSION });
    } finally {
      live.server.stop(true);
    }
  });

  test("a POSTed feedback item persists through the live handler into the injected store", async () => {
    const store = tempStore();
    const live = startLive(store, { port: 0 });
    try {
      const response = await fetch(`http://${HOST}:${live.server.port}/v1/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: "live-app", message: "shipped through the real socket", kind: "idea" }),
      });
      expect(response.status).toBe(201);
      const item = (await response.json()) as { id: string; appId: string };
      expect(item.appId).toBe("live-app");

      const listed = await store.listFeedback();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.message).toBe("shipped through the real socket");

      const reread = await fetch(`http://${HOST}:${live.server.port}/v1/feedback/${item.id}`);
      expect(reread.status).toBe(200);
      expect(((await reread.json()) as { id: string }).id).toBe(item.id);
    } finally {
      live.server.stop(true);
    }
  });

  test("explicit options beat the environment, and the environment is the default when options are absent", async () => {
    const previousPort = process.env["FEEDBACK_PORT"];
    const previousHost = process.env["FEEDBACK_HOST"];
    try {
      process.env["FEEDBACK_PORT"] = "0";
      process.env["FEEDBACK_HOST"] = "127.0.0.1";

      // No options: the environment is the default source (port 0 -> ephemeral).
      const fromEnv = startLive(tempStore());
      try {
        expect(fromEnv.server.port).toBeGreaterThan(0);
        expect(fromEnv.server.port).not.toBe(8787);
        expect(fromEnv.server.hostname).toBe("127.0.0.1");
      } finally {
        fromEnv.server.stop(true);
      }

      // Explicit options win over the environment.
      process.env["FEEDBACK_PORT"] = "9123";
      const fromOptions = startLive(tempStore(), { port: 0, host: "127.0.0.1" });
      try {
        expect(fromOptions.server.port).not.toBe(9123);
        expect(fromOptions.server.port).toBeGreaterThan(0);
      } finally {
        fromOptions.server.stop(true);
      }
    } finally {
      if (previousPort === undefined) delete process.env["FEEDBACK_PORT"];
      else process.env["FEEDBACK_PORT"] = previousPort;
      if (previousHost === undefined) delete process.env["FEEDBACK_HOST"];
      else process.env["FEEDBACK_HOST"] = previousHost;
    }
  });
});

describe("HTTP API edge gaps", () => {
  test("an unknown route is a 404 with an error body, not a crash", async () => {
    const handler = createFeedbackHandler({ store: tempStore() });
    const response = await handler(new Request(`http://${HOST}/definitely-not-a-route`));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  test("an empty JSON body on POST is a 400, not a 500", async () => {
    const handler = createFeedbackHandler({ store: tempStore() });
    const response = await handler(new Request(`http://${HOST}/v1/feedback`, { method: "POST", body: "" }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("JSON");
  });

  test("GET by id returns 404 for a missing id with the canonical error body", async () => {
    const handler = createFeedbackHandler({ store: tempStore() });
    const response = await handler(new Request(`http://${HOST}/v1/feedback/missing-id`));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Feedback not found" });
  });

  test("parseLimit clamps 999 to 500 and treats 0 and non-numeric limits as unset", async () => {
    let received: FeedbackListFilter | undefined;
    const store = {
      listFeedback: async (filter: FeedbackListFilter) => {
        received = filter;
        return [];
      },
    } as unknown as FeedbackStore;
    const handler = createFeedbackHandler({ store });

    await handler(new Request(`http://${HOST}/v1/feedback?limit=999`));
    expect(received?.limit).toBe(500);
    await handler(new Request(`http://${HOST}/v1/feedback?limit=0`));
    expect(received?.limit).toBeUndefined();
    await handler(new Request(`http://${HOST}/v1/feedback?limit=abc`));
    expect(received?.limit).toBeUndefined();
    await handler(new Request(`http://${HOST}/v1/feedback`));
    expect(received?.limit).toBeUndefined();
  });

  test("OPTIONS returns 204 with CORS headers and the configured origin", async () => {
    const handler = createFeedbackHandler({ store: tempStore(), corsOrigin: "https://app.example.com" });
    const response = await handler(new Request(`http://${HOST}/v1/feedback`, { method: "OPTIONS" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("x-feedback-token");
  });
});
