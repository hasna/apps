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

  test("refuses a bare trailing ? or #, which the URL parser reports as empty", () => {
    // `url.search` / `url.hash` are "" for these, but the raw string is what
    // gets concatenated: `…/mementos?` used to resolve to `…/mementos?/v1`.
    for (const raw of [
      "https://api.hasna.com/mementos?",
      "https://api.hasna.com/mementos#",
      "https://api.hasna.com/mementos/?",
    ]) {
      expect(() => resolveMementosApiBase(raw)).toThrow(/userinfo, query, or fragment/);
    }
  });

  test("an unparseable base is refused without echoing it", () => {
    // The parse-failure branch used to quote the raw input, so a value that
    // both fails to parse and carries userinfo was echoed verbatim.
    let message = "";
    try {
      resolveMementosApiBase("https://user:sup3rsecret@");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/absolute http\(s\) URL/);
    expect(message).not.toContain("sup3rsecret");
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

  test("an explicit baseUrl WITHOUT apiKey never attaches the ambient fleet key (hasna/apps#1794)", async () => {
    // A credential pinned to one authority must never leak onto an explicit
    // baseUrl the caller chose. The ambient env carries a real-looking key;
    // the explicit-argument client must send NO auth headers.
    const KEYS = ["HASNA_MEMENTOS_API_URL", "MEMENTOS_API_URL", "HASNA_MEMENTOS_API_KEY", "MEMENTOS_API_KEY"];
    const saved = new Map(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env["HASNA_MEMENTOS_API_KEY"] = "ambient-fleet-key-not-for-this-authority";
    const captured: Array<{ url: string; headers: HeadersInit | undefined }> = [];
    try {
      const client = new MementosClient({
        baseUrl: "https://private.example",
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          captured.push({ url: String(input), headers: init?.headers });
          return new Response(JSON.stringify({ memories: [], total: 0 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }) as typeof globalThis.fetch,
      });
      await client.listMemories({ limit: 1 });
    } finally {
      for (const k of KEYS) delete process.env[k];
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
    }
    expect(captured.length).toBe(1);
    expect(captured[0]!.url).toStartWith("https://private.example/v1/memories");
    const headers = new Headers(captured[0]!.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
  });

  test("an explicit apiKey IS sent to the explicit baseUrl", async () => {
    const captured: Array<HeadersInit | undefined> = [];
    const client = new MementosClient({
      baseUrl: "https://private.example",
      apiKey: "explicit-key",
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        captured.push(init?.headers);
        return new Response(JSON.stringify({ memories: [], total: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof globalThis.fetch,
    });
    await client.listMemories({ limit: 1 });
    const headers = new Headers(captured[0]);
    expect(headers.get("authorization")).toBe("Bearer explicit-key");
    expect(headers.get("x-api-key")).toBe("explicit-key");
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
  const KEYS = ["HASNA_MEMENTOS_API_URL", "MEMENTOS_API_URL", "HASNA_MEMENTOS_API_KEY", "MEMENTOS_API_KEY"];
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

  test("the canonical HASNA_MEMENTOS_API_URL resolves path-safely", () => {
    const url = withEnv(
      {
        HASNA_MEMENTOS_API_URL: "https://api.hasna.com/mementos",
        HASNA_MEMENTOS_API_KEY: "k",
      },
      () => MementosClient.fromEnv().apiUrl,
    );
    expect(url).toBe("https://api.hasna.com/mementos/v1");
  });

  test("disagreeing URL aliases refuse (fail closed) rather than picking one silently", () => {
    // The resolver treats two different authority aliases as a
    // misconfiguration: canonical-vs-legacy disagreement is refused, never
    // resolved by precedence.
    let message = "";
    try {
      withEnv(
        {
          HASNA_MEMENTOS_API_URL: "https://api.hasna.com/mementos",
          MEMENTOS_API_URL: "https://legacy.example",
          HASNA_MEMENTOS_API_KEY: "k",
        },
        () => MementosClient.fromEnv().apiUrl,
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("disagree");
  });

  test("resolves the legacy alias pair through the resolver", () => {
    // `MEMENTOS_API_URL` is the resolver's silent legacy alias for one
    // release — it configures the same authority as the canonical name. A
    // KEY is required with it (a URL alone refuses).
    expect(
      withEnv(
        { MEMENTOS_API_URL: "https://api.hasna.com/mementos", MEMENTOS_API_KEY: "k" },
        () => MementosClient.fromEnv().apiUrl,
      ),
    ).toBe("https://api.hasna.com/mementos/v1");
  });

  test("a KEY alone resolves to the fleet gateway authority", () => {
    // A credential alone is a complete configuration since the resolver
    // adoption: the authority defaults to https://api.hasna.com/mementos.
    expect(withEnv({ HASNA_MEMENTOS_API_KEY: "k" }, () => MementosClient.fromEnv().apiUrl)).toBe(
      "https://api.hasna.com/mementos/v1",
    );
  });

  test("a URL without a key refuses (fail closed, never a silent default)", () => {
    let message = "";
    try {
      withEnv({ HASNA_MEMENTOS_API_URL: "https://api.hasna.com/mementos" }, () =>
        MementosClient.fromEnv().apiUrl,
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("no API key could be resolved");
  });

  test("nothing configured resolves to the unhosted local serve (localhost:19428)", () => {
    expect(withEnv({}, () => MementosClient.fromEnv().apiUrl)).toBe("http://localhost:19428/v1");
  });

  test("a blank value does not select an empty authority", () => {
    expect(withEnv({ HASNA_MEMENTOS_API_URL: "   " }, () => MementosClient.fromEnv().apiUrl)).toBe(
      "http://localhost:19428/v1",
    );
  });
});
