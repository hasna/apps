import { afterEach, describe, expect, mock, test } from "bun:test";
import { StableBrowse } from "./index";
import { StableBrowseApiError } from "../types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJson(body: unknown, status = 200) {
  return mock(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

function newClient() {
  return new StableBrowse({ apiKey: "sb_live_test123456", baseUrl: "https://api.stablebrowse.ai/v1" });
}

function lastCall(fetchMock: ReturnType<typeof mockJson>) {
  const call = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit] | undefined;
  return { url: String(call?.[0]), init: (call?.[1] ?? {}) as RequestInit };
}

describe("StableBrowse client", () => {
  test("submit task POSTs to /tasks with Bearer auth and body", async () => {
    const fetchMock = mockJson({ taskId: "t1", sessionId: "s1", status: "pending", createdAt: "2026-01-01" }, 201);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newClient().tasks.submit({ endUserId: "u1", task: "search things", startUrl: "https://x.com" });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("https://api.stablebrowse.ai/v1/tasks");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sb_live_test123456");
    expect(JSON.parse(String(init.body))).toMatchObject({
      endUserId: "u1",
      task: "search things",
      startUrl: "https://x.com",
    });
  });

  test("get task GETs /tasks/{id} with url-encoded id", async () => {
    const fetchMock = mockJson({ taskId: "a b", status: "completed" });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newClient().tasks.get("a b");

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("https://api.stablebrowse.ai/v1/tasks/a%20b");
    expect(init.method).toBe("GET");
  });

  test("list tasks passes limit query param", async () => {
    const fetchMock = mockJson({ sessions: [] });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newClient().tasks.list({ limit: 10 });

    const { url } = lastCall(fetchMock);
    expect(url).toBe("https://api.stablebrowse.ai/v1/tasks?limit=10");
  });

  test("get session GETs /sessions/{id}", async () => {
    const fetchMock = mockJson({ sessionId: "s1", tasks: [] });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newClient().sessions.get("s1");

    const { url } = lastCall(fetchMock);
    expect(url).toBe("https://api.stablebrowse.ai/v1/sessions/s1");
  });

  test("set credentials PUTs to /end-users/{id}/credentials", async () => {
    const fetchMock = mockJson({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newClient().endUsers.setCredentials("u1", { redditSession: "rs" });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("https://api.stablebrowse.ai/v1/end-users/u1/credentials");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toMatchObject({ redditSession: "rs" });
  });

  test("get credentials status GETs /end-users/{id}/credentials", async () => {
    const fetchMock = mockJson({ endUserId: "u1", platforms: { reddit: true } });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newClient().endUsers.getCredentials("u1");

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("https://api.stablebrowse.ai/v1/end-users/u1/credentials");
    expect(init.method).toBe("GET");
  });

  test("design extract POSTs to /design/extract with extractor subset", async () => {
    const fetchMock = mockJson(
      { taskId: "t1", sessionId: "s1", status: "pending", extractors: ["colors"], enableIpRotation: false, createdAt: "x" },
      202
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newClient().design.extract({ url: "https://example.com", endUserId: "u1", extractors: ["colors"] });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("https://api.stablebrowse.ai/v1/design/extract");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ url: "https://example.com", extractors: ["colors"] });
  });

  test("extract-by-extractor POSTs to /design/extract/{extractor}", async () => {
    const fetchMock = mockJson({ taskId: "t1" }, 202);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newClient().design.extractByExtractor("logo", { url: "https://example.com", endUserId: "u1" });

    const { url } = lastCall(fetchMock);
    expect(url).toBe("https://api.stablebrowse.ai/v1/design/extract/logo");
  });

  test("raw escape hatch issues an arbitrary request", async () => {
    const fetchMock = mockJson({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await newClient().raw("/tasks", { method: "GET" });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("https://api.stablebrowse.ai/v1/tasks");
    expect(init.method).toBe("GET");
  });

  test("maps API error payloads to StableBrowseApiError", async () => {
    const fetchMock = mockJson({ error: "Unknown taskId" }, 404);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(newClient().tasks.get("missing")).rejects.toBeInstanceOf(StableBrowseApiError);
  });
});
