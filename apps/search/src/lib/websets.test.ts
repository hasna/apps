import { afterEach, describe, expect, it, mock } from "bun:test";
import { EXA_API_KEY_ENV, getExaConfigurationStatus } from "./exa.js";
import { createWebset, createWebsetSearch, listWebsetItems, listWebsets } from "./websets.js";

const originalFetch = globalThis.fetch;
const fixtureExaKey = "fixture-token";

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

describe("Exa configuration", () => {
  it("reports env-only configuration without exposing values", () => {
    const status = getExaConfigurationStatus({
      env: {
        [EXA_API_KEY_ENV]: fixtureExaKey,
      },
    });

    expect(status.configured).toBe(true);
    expect(status.env).toBe("EXA_API_KEY");
    expect(JSON.stringify(status)).not.toContain(fixtureExaKey);
  });
});

describe("Exa Websets client", () => {
  it("creates a webset with x-api-key auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "ws_123",
            object: "webset",
            status: "running",
            externalId: null,
            title: "Test Webset",
            searches: [],
            enrichments: [],
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          }),
          { status: 201 },
        ),
      );
    });

    const result = await createWebset(
      {
        title: "Test Webset",
        search: { query: "AI labs", count: 5 },
        "import": [{ id: "imp_existing", evaluate: true }],
        exclude: [{ id: "ws_existing" }],
        metadata: { owner: "research" },
      },
      { apiKey: fixtureExaKey, fetch: fetchMock as unknown as typeof fetch },
    );

    expect(result.id).toBe("ws_123");
    expect(calls[0]!.url).toBe("https://api.exa.ai/websets/v0/websets");
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe(fixtureExaKey);
    expect(calls[0]!.init.body).toContain('"query":"AI labs"');
    expect(calls[0]!.init.body).toContain('"id":"ws_existing"');
    expect(calls[0]!.init.body).toContain('"evaluate":true');
    expect(calls[0]!.init.body).not.toContain('"source"');
    expect(calls[0]!.init.body).toContain('"owner":"research"');
    expect(calls[0]!.init.body).not.toContain(fixtureExaKey);
  });

  it("lists websets and items with pagination query params", async () => {
    const urls: string[] = [];
    const fetchMock = mock((url: string | URL | Request) => {
      urls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ data: [], hasMore: false, nextCursor: null })),
      );
    });

    await listWebsets(
      { limit: 10, cursor: "next", search: "leads" },
      { apiKey: fixtureExaKey, fetch: fetchMock as unknown as typeof fetch },
    );
    await listWebsetItems(
      "ws_123",
      { limit: 20, sourceId: "source_1" },
      { apiKey: fixtureExaKey, fetch: fetchMock as unknown as typeof fetch },
    );

    const websetsUrl = new URL(urls[0]!);
    expect(`${websetsUrl.origin}${websetsUrl.pathname}`).toBe("https://api.exa.ai/websets/v0/websets");
    expect(websetsUrl.searchParams.get("limit")).toBe("10");
    expect(websetsUrl.searchParams.get("cursor")).toBe("next");
    expect(websetsUrl.searchParams.get("search")).toBe("leads");

    const itemsUrl = new URL(urls[1]!);
    expect(`${itemsUrl.origin}${itemsUrl.pathname}`).toBe("https://api.exa.ai/websets/v0/websets/ws_123/items");
    expect(itemsUrl.searchParams.get("limit")).toBe("20");
    expect(itemsUrl.searchParams.get("sourceId")).toBe("source_1");
  });

  it("creates an additional webset search", async () => {
    const fetchMock = mock((url: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: "search_123",
            object: "webset_search",
            websetId: "ws_123",
            query: "more companies",
            status: "created",
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await createWebsetSearch(
      "ws_123",
      {
        query: "more companies",
        count: 2,
        behavior: "append",
        scope: [{ id: "imp_123", relationship: { definition: "Existing import", limit: 5 } }],
      },
      { apiKey: fixtureExaKey, fetch: fetchMock as unknown as typeof fetch },
    );

    expect(result.id).toBe("search_123");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.exa.ai/websets/v0/websets/ws_123/searches");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toContain('"behavior":"append"');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toContain('"id":"imp_123"');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toContain('"relationship"');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).not.toContain('"source"');
    expect(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).not.toContain(fixtureExaKey);
  });

  it("does not include API keys in error messages", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "invalid key" }), {
          status: 401,
          statusText: "Unauthorized",
        }),
      ),
    );

    await expect(
      listWebsets({}, { apiKey: fixtureExaKey, fetch: fetchMock as unknown as typeof fetch }),
    ).rejects.toThrow("Exa Websets API error: 401 Unauthorized - invalid key");
  });

  it("redacts echoed API keys in upstream error messages", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: `invalid ${fixtureExaKey}` }), {
          status: 401,
          statusText: "Unauthorized",
        }),
      ),
    );

    try {
      await listWebsets({}, { apiKey: fixtureExaKey, fetch: fetchMock as unknown as typeof fetch });
      throw new Error("Expected listWebsets to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toContain("[redacted]");
      expect(message).not.toContain(fixtureExaKey);
    }
  });
});
