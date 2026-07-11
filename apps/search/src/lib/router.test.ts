import { describe, expect, mock, test, afterEach } from "bun:test";
import { clearRouterCache, routeSearchProviders, routeSearchProvidersHeuristic } from "./router.js";

const originalFetch = globalThis.fetch;
const originalApiKey = Bun.env.CEREBRAS_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete Bun.env.CEREBRAS_API_KEY;
  else Bun.env.CEREBRAS_API_KEY = originalApiKey;
  clearRouterCache();
});

describe("routeSearchProvidersHeuristic", () => {
  test("routes local code symbol queries to content and files", () => {
    const route = routeSearchProvidersHeuristic(
      "find export function buildServer in src/mcp/server.ts",
      ["files", "content", "github", "arxiv"],
      { maxProviders: 2 },
    );

    expect(route.strategy).toBe("heuristic");
    expect(route.selectedProviders).toEqual(["content", "files"]);
    expect(route.reason).toContain("local-file");
  });

  test("routes research paper queries to arxiv first", () => {
    const route = routeSearchProvidersHeuristic(
      "latest papers on query routing for federated RAG",
      ["brave", "arxiv", "exa", "perplexity"],
      { maxProviders: 3 },
    );

    expect(route.selectedProviders[0]).toBe("arxiv");
    expect(route.selectedProviders).toContain("exa");
  });
});

describe("routeSearchProviders", () => {
  test("uses heuristic fallback when Cerebras API key is missing", async () => {
    delete Bun.env.CEREBRAS_API_KEY;

    const route = await routeSearchProviders("github repo for sqlite fts", ["github", "exa"]);

    expect(route.strategy).toBe("heuristic");
    expect(route.selectedProviders[0]).toBe("github");
    expect(route.error).toContain("CEREBRAS_API_KEY");
  });

  test("uses Cerebras structured output when available", async () => {
    Bun.env.CEREBRAS_API_KEY = "test-key";
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.response_format.type).toBe("json_schema");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  selectedProviders: ["youtube"],
                  reason: "The query asks for tutorial videos.",
                  confidence: 0.82,
                }),
              },
            },
          ],
        }),
      );
    }) as unknown as typeof fetch;

    const route = await routeSearchProviders("video tutorial sqlite fts", ["youtube", "brave"], {
      maxProviders: 2,
    });

    expect(route.strategy).toBe("cerebras");
    expect(route.selectedProviders).toEqual(["youtube"]);
    expect(route.confidence).toBe(0.82);
  });

  test("skips Cerebras for high-confidence local code queries", async () => {
    Bun.env.CEREBRAS_API_KEY = "test-key";
    globalThis.fetch = mock(() => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    const route = await routeSearchProviders(
      "find export function buildServer in src/mcp/server.ts",
      ["github", "files", "content", "arxiv"],
      { maxProviders: 3 },
    );

    expect(route.strategy).toBe("heuristic");
    expect(route.selectedProviders).toEqual(["content", "files"]);
    expect(route.reason).toContain("local fast-path");
  });

  test("caches successful Cerebras routing decisions", async () => {
    Bun.env.CEREBRAS_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  selectedProviders: ["brave"],
                  reason: "The query asks for current web results.",
                  confidence: 0.74,
                }),
              },
            },
          ],
        }),
      );
    }) as unknown as typeof fetch;

    const first = await routeSearchProviders("latest sqlite release", ["brave", "exa"], {
      maxProviders: 2,
    });
    const second = await routeSearchProviders("latest sqlite release", ["brave", "exa"], {
      maxProviders: 2,
    });

    expect(calls).toBe(1);
    expect(first.cached).toBeUndefined();
    expect(second.cached).toBe(true);
    expect(second.selectedProviders).toEqual(["brave"]);
  });
});
