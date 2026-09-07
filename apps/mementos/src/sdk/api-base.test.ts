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
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import {
  MementosClient,
  MementosConfigError,
  __resetMementosSdkLocalNotice,
  resolveMementosApiBase,
  resolveMementosSdkTransport,
} from "./index";

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
  // The local opt-in flags are managed too: the test preload pins
  // HASNA_MEMENTOS_LOCAL=1 for every test process, and a case that means
  // "nothing configured" must not inherit it by accident.
  const KEYS = [
    "HASNA_MEMENTOS_API_URL",
    "MEMENTOS_API_URL",
    "HASNA_MEMENTOS_API_KEY",
    "MEMENTOS_API_KEY",
    "HASNA_MEMENTOS_LOCAL",
    "MEMENTOS_LOCAL",
  ];
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

  test("the deliberate local opt-in (HASNA_MEMENTOS_LOCAL=1) with nothing else configured resolves to the unhosted local serve (localhost:19428)", () => {
    expect(withEnv({ HASNA_MEMENTOS_LOCAL: "1" }, () => MementosClient.fromEnv().apiUrl)).toBe(
      "http://localhost:19428/v1",
    );
  });

  test("a blank value does not select an empty authority (the opt-in still answers)", () => {
    expect(
      withEnv({ HASNA_MEMENTOS_API_URL: "   ", HASNA_MEMENTOS_LOCAL: "1" }, () => MementosClient.fromEnv().apiUrl),
    ).toBe("http://localhost:19428/v1");
  });
});

// ============================================================================
// FAIL CLOSED when nothing resolves (owner ruling 2026-09-04; hasna/apps#1720
// acceptance (c)). The SDK used to degrade to the unhosted local serve with
// only a stderr notice; it now refuses BEFORE any request is built, exactly as
// the CLI and the MCP server do. A caller-built env object is the hermetic
// seam: the Keychain tier is off by identity (and HASNA_STATION names an
// account no item can exist under regardless), and HOME / HASNA_HOME /
// HASNA_CONFIG_HOME point at an empty scratch directory so the disk tier finds
// no credentials file — the shape of a station with no fleet credential.
// ============================================================================

describe("fail closed when nothing resolves (hasna/apps#1720 acceptance (c))", () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  function hermeticEnv(extra: Record<string, string> = {}): Record<string, string> {
    const home = mkdtempSync(join(tmpdir(), "mementos-sdk-hermetic-"));
    scratch.push(home);
    return { HOME: home, HASNA_HOME: home, HASNA_CONFIG_HOME: home, HASNA_STATION: "no-such-station", ...extra };
  }

  function recorder(): { fetch: typeof globalThis.fetch; calls: string[] } {
    const calls: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({ memories: [], count: 0, total: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;
    return { fetch, calls };
  }

  test("FAILING INPUT: resolveMementosSdkTransport throws MementosConfigError naming the tiers — never local-serve", () => {
    let error: unknown;
    try {
      resolveMementosSdkTransport({ env: hermeticEnv() });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MementosConfigError);
    expect((error as { code?: string }).code).toBe("MEMENTOS_STORE_CONFIG");
    const message = (error as Error).message;
    for (const needle of [
      "will NOT fall back",
      "hasna.credentials.mementos.api-key",
      "config/credentials",
      "HASNA_MEMENTOS_API_KEY",
      "HASNA_MEMENTOS_API_URL",
      "HASNA_MEMENTOS_LOCAL",
      "HASNA_MEMENTOS_DB_PATH",
    ]) {
      expect(message).toContain(needle);
    }
    // The resolver's own refusal travels as the cause, never as a local mode.
    expect((error as { cause?: Error }).cause?.message).toContain("no API key could be resolved");
  });

  test("listMemories rejects BEFORE any request is built — zero fetch calls", async () => {
    const { fetch, calls } = recorder();
    const client = new MementosClient({ env: hermeticEnv(), fetch });
    await expect(client.listMemories({ limit: 1 })).rejects.toBeInstanceOf(MementosConfigError);
    expect(calls).toEqual([]);
  });

  test("apiUrl throws the same refusal instead of reporting localhost:19428", () => {
    const client = new MementosClient({ env: hermeticEnv() });
    expect(() => client.apiUrl).toThrow(MementosConfigError);
  });

  test("the notice hook is NOT called — a refusal is an error, not a local-mode announcement", () => {
    const lines: string[] = [];
    expect(() => resolveMementosSdkTransport({ env: hermeticEnv(), notice: (line) => lines.push(line) })).toThrow(
      MementosConfigError,
    );
    expect(lines).toEqual([]);
  });

  test("control: the deliberate opt-in (HASNA_MEMENTOS_LOCAL=1) still resolves the local serve and says so once", () => {
    __resetMementosSdkLocalNotice();
    const lines: string[] = [];
    const env = hermeticEnv({ HASNA_MEMENTOS_LOCAL: "1" });
    const transport = resolveMementosSdkTransport({ env, notice: (line) => lines.push(line) });
    expect(transport.mode).toBe("local-serve");
    expect(transport.baseUrl).toBe("http://localhost:19428");
    expect(transport.apiKey).toBeNull();
    expect(transport.apiUrlSource).toBe("local-serve");
    resolveMementosSdkTransport({ env, notice: (line) => lines.push(line) });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/LOCAL mode/);
    expect(lines[0]).toContain("HASNA_MEMENTOS_LOCAL");
  });

  test("control: a credential in the env resolves hosted (the fleet gateway)", () => {
    const transport = resolveMementosSdkTransport({ env: hermeticEnv({ HASNA_MEMENTOS_API_KEY: "k" }) });
    expect(transport.mode).toBe("http");
    expect(transport.baseUrl).toBe("https://api.hasna.com/mementos");
    expect(transport.apiKeySource).toBe("HASNA_MEMENTOS_API_KEY");
  });

  test("control: the Keychain tier (injected runner) resolves hosted with the item as the source", () => {
    const run = (argv: readonly string[]): KeychainCommandResult => {
      const at = argv.indexOf("-s");
      const service = at >= 0 ? argv[at + 1] : undefined;
      return service === "hasna.credentials.mementos.api-key"
        ? { status: 0, stdout: "fixture-keychain-key\n", stderr: "" }
        : { status: 44, stdout: "", stderr: "" };
    };
    const transport = resolveMementosSdkTransport({
      env: hermeticEnv({ HASNA_STATION: "fixture-station" }),
      credentials: { keychain: { platform: "darwin", run } },
    });
    expect(transport.mode).toBe("http");
    expect(transport.baseUrl).toBe("https://api.hasna.com/mementos");
    expect(transport.apiKeySource).toBe("keychain:hasna.credentials.mementos.api-key@fixture-station");
  });
});
