import { afterEach, describe, expect, it, mock } from "bun:test";
import { checkExaWebSearch } from "./exa.js";
import { searchWeb } from "./search-web.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

describe("Exa web search configuration", () => {
  it("reports env-only status without exposing values", () => {
    const status = checkExaWebSearch({ env: { EXA_API_KEY: "secret-value" } });

    expect(status.available).toBe(true);
    expect(status.env).toBe("EXA_API_KEY");
    expect(JSON.stringify(status)).not.toContain("secret-value");
  });

  it("throws a preflight error when EXA_API_KEY is missing", async () => {
    await expect(searchWeb("test", { env: {} })).rejects.toThrow(
      "EXA_API_KEY is not set. Export EXA_API_KEY before using Exa web search.",
    );
  });
});

describe("searchWeb", () => {
  it("uses x-api-key auth and does not include the key in the request body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = mock((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              { url: "https://example.com", title: "Example", text: "Example text", publishedDate: "2026-01-01" },
            ],
          }),
        ),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const results = await searchWeb("test query", {
      apiKey: "secret-value",
      limit: 3,
      category: "news",
    });

    expect(results[0]!.url).toBe("https://example.com");
    expect(calls[0]!.url).toBe("https://api.exa.ai/search");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("secret-value");
    expect(String(calls[0]!.init.body)).toContain('"category":"news"');
    expect(String(calls[0]!.init.body)).not.toContain("secret-value");
  });
});
