import { describe, expect, test } from "bun:test";
import { ChangelogClient, createChangelogClient, type FetchLike } from "./client.js";

interface CapturedRequest {
  url: URL;
  init: RequestInit;
}

function captureFetch(response: () => Response): { calls: CapturedRequest[]; fetch: FetchLike } {
  const calls: CapturedRequest[] = [];
  return {
    calls,
    fetch: async (input, init = {}) => {
      const rawUrl = input instanceof Request ? input.url : input.toString();
      calls.push({ url: new URL(rawUrl), init });
      return response();
    },
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("ChangelogClient", () => {
  test("normalizes a base URL without a trailing slash", async () => {
    const stub = captureFetch(() => jsonResponse({ ok: true, service: "changelog", version: "1.2.3" }));
    const client = new ChangelogClient({ baseUrl: "https://example.test/api", fetch: stub.fetch });

    await client.health();

    expect(stub.calls[0]?.url.href).toBe("https://example.test/api/health");
  });

  test("keeps a trailing-slash base path and creates clients through the factory", async () => {
    const stub = captureFetch(() => jsonResponse({ total: 0, byApp: {}, byVersion: {}, byKind: {} }));
    const client = createChangelogClient({ baseUrl: "https://example.test/api/", fetch: stub.fetch });

    await client.stats();

    expect(client).toBeInstanceOf(ChangelogClient);
    expect(stub.calls[0]?.url.href).toBe("https://example.test/api/v1/stats");
  });

  test("serializes all list filters without leaking them into headers", async () => {
    const stub = captureFetch(() => jsonResponse([]));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    await client.list({
      appId: "app with spaces",
      version: "1.0.0",
      kind: "fixed",
      category: "security",
      tag: "edge/case",
      limit: 25,
    });

    const request = stub.calls[0];
    expect(request?.url.pathname).toBe("/v1/entries");
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      appId: "app with spaces",
      version: "1.0.0",
      kind: "fixed",
      category: "security",
      tag: "edge/case",
      limit: "25",
    });
    expect(new Headers(request?.init.headers).has("authorization")).toBe(false);
  });

  test("percent-encodes entry IDs as one path segment", async () => {
    const stub = captureFetch(() => jsonResponse({ id: "ignored" }));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    await client.get("release/one two");

    expect(stub.calls[0]?.url.pathname).toBe("/v1/entries/release%2Fone%20two");
  });

  test("adds JSON and bearer headers for writes", async () => {
    const stub = captureFetch(() => jsonResponse({ id: "entry-1" }));
    const credential = ["unit", "value"].join("-");
    const client = new ChangelogClient({
      baseUrl: "https://example.test/",
      token: credential,
      fetch: stub.fetch,
    });

    await client.add({ appId: "demo", title: "Added" }, { allowDuplicate: true });

    const request = stub.calls[0];
    const headers = new Headers(request?.init.headers);
    expect(request?.init.method).toBe("POST");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe(`Bearer ${credential}`);
    expect(JSON.parse(String(request?.init.body))).toEqual({
      appId: "demo",
      title: "Added",
      allowDuplicate: true,
    });
  });

  test("uses GET text generation when presentation options are absent", async () => {
    const stub = captureFetch(() => new Response("# Changelog\n"));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    const markdown = await client.generate({ appId: "demo", limit: 2 });

    expect(markdown).toBe("# Changelog\n");
    expect(stub.calls[0]?.init.method).toBeUndefined();
    expect(stub.calls[0]?.url.searchParams.get("appId")).toBe("demo");
    expect(stub.calls[0]?.url.searchParams.get("limit")).toBe("2");
  });

  test("uses POST JSON generation when title or repository metadata is present", async () => {
    const stub = captureFetch(() => jsonResponse({ markdown: "# Product\n" }));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    const markdown = await client.generate({
      appId: "demo",
      title: "Product",
      repositoryUrl: "https://example.test/repo",
    });

    expect(markdown).toBe("# Product\n");
    expect(stub.calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(stub.calls[0]?.init.body))).toMatchObject({
      appId: "demo",
      title: "Product",
      repositoryUrl: "https://example.test/repo",
    });
  });

  test("PATCHes an encoded entry path with only the requested update", async () => {
    const stub = captureFetch(() => jsonResponse({ id: "entry/one", title: "Corrected" }));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    const result = await client.update("entry/one", { title: "Corrected", tags: [] });

    expect(result).toMatchObject({ id: "entry/one", title: "Corrected" });
    expect(stub.calls[0]?.url.pathname).toBe("/v1/entries/entry%2Fone");
    expect(stub.calls[0]?.init.method).toBe("PATCH");
    expect(JSON.parse(String(stub.calls[0]?.init.body))).toEqual({ title: "Corrected", tags: [] });
  });

  test("sends publish and release payloads to their distinct endpoints", async () => {
    const responses = [
      { mode: "dry-run", targetPath: "/tmp/CHANGELOG.md", markdown: "# Changelog\n", changed: true, bytes: 12 },
      { appId: "demo", fromVersion: "Unreleased", version: "1.2.3", date: "2026-08-17", updated: 0, entries: [] },
    ];
    let index = 0;
    const stub = captureFetch(() => jsonResponse(responses[index++]));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    const published = await client.publish({ appId: "demo", write: false, diff: true });
    const released = await client.release({ appId: "demo", version: "1.2.3", date: "2026-08-17" });

    expect(published.mode).toBe("dry-run");
    expect(released.version).toBe("1.2.3");
    expect(stub.calls.map((call) => call.url.pathname)).toEqual(["/v1/publish", "/v1/release"]);
    expect(stub.calls.map((call) => call.init.method)).toEqual(["POST", "POST"]);
    expect(JSON.parse(String(stub.calls[0]?.init.body))).toEqual({ appId: "demo", write: false, diff: true });
    expect(JSON.parse(String(stub.calls[1]?.init.body))).toEqual({
      appId: "demo",
      version: "1.2.3",
      date: "2026-08-17",
    });
  });

  test("exports JSONL with the same filter encoding as list", async () => {
    const stub = captureFetch(() => new Response('{"id":"one"}\n'));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    const jsonl = await client.exportJsonl({ appId: "demo", tag: "release candidate", limit: 1 });

    expect(jsonl).toBe('{"id":"one"}\n');
    expect(stub.calls[0]?.url.pathname).toBe("/v1/export.jsonl");
    expect(Object.fromEntries(stub.calls[0]?.url.searchParams ?? [])).toEqual({
      appId: "demo",
      tag: "release candidate",
      limit: "1",
    });
  });

  test("surfaces structured API error messages", async () => {
    const stub = captureFetch(() => jsonResponse({ error: "entry missing" }, { status: 404 }));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    expect(client.get("missing")).rejects.toThrow("entry missing");
  });

  test("surfaces a plain-text upstream error instead of a JSON parse failure", async () => {
    const stub = captureFetch(() => new Response("upstream unavailable", {
      status: 502,
      statusText: "Bad Gateway",
    }));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    expect(client.stats()).rejects.toThrow("upstream unavailable");
  });

  test("falls back to HTTP status text for an empty error response", async () => {
    const stub = captureFetch(() => new Response(null, {
      status: 503,
      statusText: "Service Unavailable",
    }));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    expect(client.stats()).rejects.toThrow("Service Unavailable");
  });

  test("surfaces text endpoint errors without attempting JSON parsing", async () => {
    const stub = captureFetch(() => new Response("export denied", {
      status: 403,
      statusText: "Forbidden",
    }));
    const client = new ChangelogClient({ baseUrl: "https://example.test/", fetch: stub.fetch });

    expect(client.exportJsonl()).rejects.toThrow("export denied");
  });
});
