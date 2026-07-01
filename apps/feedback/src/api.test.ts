import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFeedbackHandler } from "./api.js";
import { FeedbackClient } from "./client.js";
import { LocalFeedbackStore } from "./storage.js";

async function createTestClient() {
  const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-api-")) });
  const handler = createFeedbackHandler({ store, apiToken: "test-token" });
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return handler(request);
  };
  return new FeedbackClient({
    baseUrl: "http://feedback.test",
    token: "test-token",
    fetch: fetchImpl,
  });
}

describe("Feedback HTTP API and SDK", () => {
  test("supports browser-relative base URLs", async () => {
    const seen: string[] = [];
    const client = new FeedbackClient({
      baseUrl: "/api/feedback",
      fetch: async (input) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ id: "fb_1", appId: "browser-app", message: "Browser feedback" }), { status: 201 });
      },
    });
    expect(await client.submit({ appId: "browser-app", message: "Browser feedback" })).toMatchObject({
      appId: "browser-app",
    });
    await client.list({ appId: "browser-app", limit: 2 });
    expect(seen).toEqual([
      "/api/feedback/v1/feedback",
      "/api/feedback/v1/feedback?appId=browser-app&limit=2",
    ]);
  });

  test("submits and lists feedback through SDK", async () => {
    const client = await createTestClient();
    const created = await client.submit({
      appId: "sdk-app",
      message: "SDK issue",
      kind: "bug",
    });
    expect(created.id).toBeString();
    expect(created.source).toBe("api");

    const list = await client.list({ appId: "sdk-app", search: "issue", since: "2026-01-01" });
    expect(list).toHaveLength(1);
    expect(list[0]?.message).toBe("SDK issue");
    expect(await client.stats()).toMatchObject({ total: 1 });
    expect(await client.exportJsonl({ appId: "sdk-app" })).toContain("SDK issue");
  });

  test("rejects requests with missing token when configured", async () => {
    const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-auth-")) });
    const handler = createFeedbackHandler({ store, apiToken: "required" });
    const response = await handler(new Request("http://feedback.test/v1/feedback"));
    expect(response.status).toBe(401);
  });
});
