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
  test("submits and lists feedback through SDK", async () => {
    const client = await createTestClient();
    const created = await client.submit({
      appId: "sdk-app",
      message: "SDK issue",
      kind: "bug",
    });
    expect(created.id).toBeString();
    expect(created.source).toBe("api");

    const list = await client.list({ appId: "sdk-app" });
    expect(list).toHaveLength(1);
    expect(list[0]?.message).toBe("SDK issue");
    expect(await client.stats()).toMatchObject({ total: 1 });
  });

  test("rejects requests with missing token when configured", async () => {
    const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-auth-")) });
    const handler = createFeedbackHandler({ store, apiToken: "required" });
    const response = await handler(new Request("http://feedback.test/v1/feedback"));
    expect(response.status).toBe(401);
  });
});

