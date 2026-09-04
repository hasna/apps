/**
 * The SDK client must survive a PATH-PREFIXED gateway base URL.
 *
 * The fleet gateway addresses this app as `https://api.hasna.com/mementos/v1`
 * (hasna/apps#1512). hasna/apps#1601 recorded the defect class: a client that
 * rebuilds its routes from `new URL(base).origin` drops the `/mementos`
 * segment and can never reach the gateway, and one that blindly appends `/v1`
 * to a base that already ends in `/v1` sends `/mementos/v1/v1/memories`.
 * Both shapes are asserted here against the real request path.
 */
import { describe, expect, test } from "bun:test";
import { MementosClient, resolveMementosApiBase } from "./index";

/** Capture the URL the client actually fetches, and answer with an empty list. */
function recordingClient(baseUrl: string | undefined, prefix?: string): { client: MementosClient; urls: string[] } {
  const urls: string[] = [];
  const client = new MementosClient({
    baseUrl,
    prefix,
    apiKey: "test-key",
    fetch: (async (input: RequestInfo | URL) => {
      urls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({ memories: [], total: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch,
  });
  return { client, urls };
}

describe("resolveMementosApiBase", () => {
  const cases: Array<[string, string]> = [
    ["https://mementos.hasna.xyz", "https://mementos.hasna.xyz/v1"],
    ["https://mementos.hasna.xyz/", "https://mementos.hasna.xyz/v1"],
    ["https://mementos.hasna.xyz/v1", "https://mementos.hasna.xyz/v1"],
    ["https://api.hasna.com/mementos", "https://api.hasna.com/mementos/v1"],
    ["https://api.hasna.com/mementos/", "https://api.hasna.com/mementos/v1"],
    ["https://api.hasna.com/mementos/v1", "https://api.hasna.com/mementos/v1"],
    ["https://api.hasna.com/mementos/v1/", "https://api.hasna.com/mementos/v1"],
    ["  https://api.hasna.com/mementos  ", "https://api.hasna.com/mementos/v1"],
  ];
  for (const [raw, expected] of cases) {
    test(`${raw.trim()} resolves to ${expected}`, () => {
      const { baseUrl, prefix } = resolveMementosApiBase(raw);
      expect(`${baseUrl}${prefix}`).toBe(expected);
    });
  }

  test("the legacy /api prefix is preserved, never re-versioned", () => {
    expect(resolveMementosApiBase("https://api.hasna.com/mementos/api")).toEqual({
      baseUrl: "https://api.hasna.com/mementos",
      prefix: "/api",
    });
  });

  test("an explicit prefix replaces the versioned segment the base carries", () => {
    // /mementos/v1 + explicit /api must not become /mementos/v1/api: the
    // server serves no such route.
    expect(resolveMementosApiBase("https://api.hasna.com/mementos/v1", "/api")).toEqual({
      baseUrl: "https://api.hasna.com/mementos",
      prefix: "/api",
    });
    expect(resolveMementosApiBase("https://api.hasna.com/mementos/api", "/api")).toEqual({
      baseUrl: "https://api.hasna.com/mementos",
      prefix: "/api",
    });
    expect(resolveMementosApiBase("https://api.hasna.com/mementos/api", "/v1")).toEqual({
      baseUrl: "https://api.hasna.com/mementos",
      prefix: "/v1",
    });
    // A base with no versioned segment keeps its whole path.
    expect(resolveMementosApiBase("https://api.hasna.com/mementos", "/api")).toEqual({
      baseUrl: "https://api.hasna.com/mementos",
      prefix: "/api",
    });
  });

  test("refuses a base carrying userinfo, a query or a fragment", () => {
    for (const raw of [
      "https://user:pass@api.hasna.com/mementos",
      "https://api.hasna.com/mementos?x=1",
      "https://api.hasna.com/mementos/v1#frag",
    ]) {
      expect(() => resolveMementosApiBase(raw)).toThrow(/userinfo, query, or fragment/);
    }
  });

  test("refuses a non-http(s) or unparseable base", () => {
    expect(() => resolveMementosApiBase("ftp://api.hasna.com/mementos")).toThrow(/absolute http\(s\) URL/);
    expect(() => resolveMementosApiBase("api.hasna.com/mementos")).toThrow(/absolute http\(s\) URL/);
  });

  test("an empty or absent base falls back to the on-box default", () => {
    expect(resolveMementosApiBase(undefined)).toEqual({ baseUrl: "http://localhost:19428", prefix: "/v1" });
    expect(resolveMementosApiBase("   ")).toEqual({ baseUrl: "http://localhost:19428", prefix: "/v1" });
  });
});

describe("MementosClient against a gateway base", () => {
  test("keeps the /mementos path prefix on data routes (no origin-only rebuild)", async () => {
    const { client, urls } = recordingClient("https://api.hasna.com/mementos");
    await client.listMemories({ limit: 1 });
    expect(urls[0]!.startsWith("https://api.hasna.com/mementos/v1/memories")).toBe(true);
  });

  test("does not double the version when the base already ends in /v1", async () => {
    const { client, urls } = recordingClient("https://api.hasna.com/mementos/v1");
    await client.listMemories({ limit: 1 });
    expect(urls[0]).not.toContain("/v1/v1/");
    expect(urls[0]!.startsWith("https://api.hasna.com/mementos/v1/memories")).toBe(true);
  });

  test("open probes stay at the deployment root, under the path prefix", async () => {
    const { client, urls } = recordingClient("https://api.hasna.com/mementos/v1");
    await client.getHealth();
    expect(urls[0]).toBe("https://api.hasna.com/mementos/health");
  });

  test("apiUrl reports the resolved /v1 root, never a bare origin", () => {
    const { client } = recordingClient("https://api.hasna.com/mementos");
    expect(client.apiUrl).toBe("https://api.hasna.com/mementos/v1");
  });
});

describe("MementosClient.fromEnv", () => {
  const KEYS = ["HASNA_MEMENTOS_API_URL", "MEMENTOS_API_URL", "MEMENTOS_URL", "HASNA_MEMENTOS_API_KEY", "MEMENTOS_API_KEY"];
  function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): T {
    const saved = new Map(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
    try {
      return fn();
    } finally {
      for (const k of KEYS) delete process.env[k];
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
    }
  }

  test("prefers the canonical HASNA_MEMENTOS_API_URL and resolves it path-safely", () => {
    const url = withEnv(
      { HASNA_MEMENTOS_API_URL: "https://api.hasna.com/mementos", MEMENTOS_API_URL: "https://legacy.example" },
      () => MementosClient.fromEnv().apiUrl,
    );
    expect(url).toBe("https://api.hasna.com/mementos/v1");
  });

  test("falls back to the short aliases", () => {
    expect(withEnv({ MEMENTOS_API_URL: "https://api.hasna.com/mementos/v1" }, () => MementosClient.fromEnv().apiUrl)).toBe(
      "https://api.hasna.com/mementos/v1",
    );
    expect(withEnv({ MEMENTOS_URL: "https://mementos.hasna.xyz" }, () => MementosClient.fromEnv().apiUrl)).toBe(
      "https://mementos.hasna.xyz/v1",
    );
  });

  test("a blank value does not select an empty authority", () => {
    expect(withEnv({ HASNA_MEMENTOS_API_URL: "   " }, () => MementosClient.fromEnv().apiUrl)).toBe("http://localhost:19428/v1");
  });
});
