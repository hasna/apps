import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFeedbackHandler } from "./api.js";
import { FeedbackClient } from "./client.js";
import { LocalFeedbackStore } from "./storage.js";

async function createTestClient() {
  const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-api-")) });
  const tokenValue = ["test", "token"].join("-");
  const handler = createFeedbackHandler({ store, apiToken: tokenValue });
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return handler(request);
  };
  return new FeedbackClient({
    baseUrl: "http://feedback.test",
    token: tokenValue,
    fetch: fetchImpl,
  });
}

function scopedCredentials() {
  return {
    submit: ["submit", "scope"].join("-"),
    read: ["read", "scope"].join("-"),
    triage: ["triage", "scope"].join("-"),
    export: ["export", "scope"].join("-"),
  };
}

function bearer(value: string): Record<string, string> {
  return { Authorization: ["Bearer", value].join(" ") };
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

  test("allows public submit but requires read scope for shared deployment reads", async () => {
    const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-shared-")) });
    const credentials = scopedCredentials();
    const handler = createFeedbackHandler({ store, tokens: credentials, publicSubmit: true, sharedDeployment: true });

    const created = await handler(new Request("http://feedback.test/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: "shared-app", message: "Public submit works" }),
    }));
    expect(created.status).toBe(201);

    const unauthenticatedList = await handler(new Request("http://feedback.test/v1/feedback"));
    expect(unauthenticatedList.status).toBe(401);

    const authorizedList = await handler(new Request("http://feedback.test/v1/feedback", {
      headers: bearer(credentials.read),
    }));
    expect(authorizedList.status).toBe(200);
    expect(await authorizedList.json()).toHaveLength(1);
  });

  test("splits read, triage, and export scopes", async () => {
    const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-scopes-")) });
    const credentials = scopedCredentials();
    const handler = createFeedbackHandler({ store, tokens: credentials, publicSubmit: true, sharedDeployment: true });
    const created = await handler(new Request("http://feedback.test/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: "scope-app", message: "Needs triage" }),
    }));
    const item = await created.json() as { id: string };

    const wrongScope = await handler(new Request(`http://feedback.test/v1/feedback/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...bearer(credentials.read) },
      body: JSON.stringify({ status: "triaged" }),
    }));
    expect(wrongScope.status).toBe(401);

    const triaged = await handler(new Request(`http://feedback.test/v1/feedback/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...bearer(credentials.triage) },
      body: JSON.stringify({ status: "triaged" }),
    }));
    expect(triaged.status).toBe(200);

    const exportWithoutScope = await handler(new Request("http://feedback.test/v1/export.jsonl", {
      headers: bearer(credentials.read),
    }));
    expect(exportWithoutScope.status).toBe(401);

    const exported = await handler(new Request("http://feedback.test/v1/export.jsonl", {
      headers: bearer(credentials.export),
    }));
    expect(exported.status).toBe(200);
    expect(await exported.text()).toContain("Needs triage");
  });

  test("fails closed for shared deployment reads when read token is missing", async () => {
    const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-failclosed-")) });
    const handler = createFeedbackHandler({ store, tokens: { submit: "submit-scope" }, publicSubmit: true, sharedDeployment: true });
    const response = await handler(new Request("http://feedback.test/v1/feedback"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Open Feedback read access is disabled until a scoped token is configured." });
  });

  test("rate limits, suppresses duplicate submissions, and rejects spammy payloads before storage", async () => {
    const store = new LocalFeedbackStore({ dataDir: await mkdtemp(join(tmpdir(), "open-feedback-rate-")) });
    const handler = createFeedbackHandler({
      store,
      publicSubmit: true,
      sharedDeployment: true,
      rateLimit: { windowMs: 60_000, maxSubmissions: 1 },
    });

    const first = await handler(new Request("http://feedback.test/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ appId: "rate-app", message: "first issue" }),
    }));
    expect(first.status).toBe(201);

    const second = await handler(new Request("http://feedback.test/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ appId: "rate-app", message: "second issue" }),
    }));
    expect(second.status).toBe(429);

    const duplicate = await handler(new Request("http://feedback.test/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.4" },
      body: JSON.stringify({ appId: "rate-app", message: "first issue" }),
    }));
    expect(duplicate.status).toBe(409);

    const spam = await handler(new Request("http://feedback.test/v1/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.5" },
      body: JSON.stringify({ appId: "rate-app", message: "x" }),
    }));
    expect(spam.status).toBe(400);
  });
});
