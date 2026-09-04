import { describe, expect, test } from "bun:test";
import {
  CLIENT_TRANSPORTS,
  ClientTransportConfigurationError,
  HasnaHttpError,
  appendQuery,
  createClientTransport,
  createHasnaHttpTransport,
  defaultFleetGatewayBaseUrl,
  resolveClientTransport,
  toV1BaseUrl,
} from "./transport.js";

const validEnv = {
  HASNA_TODOS_API_URL: "https://todos.example.test",
  HASNA_TODOS_API_KEY: "test-key",
};

describe("canonical client transport", () => {
  test("publishes exactly one runtime transport", () => {
    expect(CLIENT_TRANSPORTS).toEqual(["http"]);
  });

  test("fails closed when no credential resolves, with or without an authority", () => {
    expect(() => resolveClientTransport("todos", {})).toThrow(ClientTransportConfigurationError);
    expect(() => resolveClientTransport("todos", {})).toThrow(/HASNA_TODOS_API_URL is not set and no API key.*required/);
    expect(() => resolveClientTransport("todos", { HASNA_TODOS_API_URL: validEnv.HASNA_TODOS_API_URL })).toThrow(
      ClientTransportConfigurationError,
    );
  });

  test("a key from any tier with no configured URL defaults to the fleet gateway", () => {
    const resolution = resolveClientTransport("todos", { HASNA_TODOS_API_KEY: "key" });
    expect(resolution).toMatchObject({
      transport: "http",
      baseUrl: "https://api.hasna.com/todos/v1",
      transportSource: "default",
      apiUrlSource: "default",
      apiKeySource: "HASNA_TODOS_API_KEY",
      apiKeyTier: "env",
      misconfigured: false,
    });
    expect(resolution.warning).toBeNull();
    expect(defaultFleetGatewayBaseUrl("todos")).toBe("https://api.hasna.com/todos");
    // Any configured authority — the env here — overrides the default.
    expect(resolveClientTransport("todos", validEnv).apiUrlSource).toBe("HASNA_TODOS_API_URL");
  });

  test("the Keychain api-url item overrides the default and must agree with the env URL", () => {
    const run = (argv: readonly string[]) =>
      argv.includes("hasna.credentials.todos.api-url")
        ? { status: 0, stdout: "https://pinned.example.test\n", stderr: "" }
        : { status: 44, stdout: "", stderr: "not found" };
    const keychain = { platform: "darwin", hostname: () => "fixture-host", run };
    const pinned = resolveClientTransport("todos", { HASNA_TODOS_API_KEY: "key" }, { credentials: { keychain } });
    expect(pinned.baseUrl).toBe("https://pinned.example.test/v1");
    expect(pinned.apiUrlSource).toBe("keychain:hasna.credentials.todos.api-url@fixture-host");
    expect(pinned.transportSource).toBe(pinned.apiUrlSource!);
    expect(pinned.warning).toContain("No HASNA_TODOS_API_URL in the environment");
    expect(() => resolveClientTransport("todos", validEnv, { credentials: { keychain } })).toThrow(
      /different service authorities/,
    );
    expect(
      resolveClientTransport("todos", { ...validEnv, HASNA_TODOS_API_URL: "https://pinned.example.test" }, {
        credentials: { keychain },
      }).apiUrlSource,
    ).toBe("HASNA_TODOS_API_URL");
  });

  test("defined-blank declarations are errors, never local selectors", () => {
    expect(() => resolveClientTransport("todos", { ...validEnv, HASNA_TODOS_API_URL: " " })).toThrow(/blank/);
    expect(() => resolveClientTransport("todos", { ...validEnv, HASNA_TODOS_API_KEY: " " })).toThrow(/blank|empty/);
  });

  test("a gateway base URL keeps its app prefix through resolution (#1601)", () => {
    const resolution = resolveClientTransport("todos", {
      HASNA_TODOS_API_URL: "https://api.example.test/todos",
      HASNA_TODOS_API_KEY: "test-key",
    });
    expect(resolution.baseUrl).toBe("https://api.example.test/todos/v1");
    expect(resolution.apiBase).toBe("https://api.example.test/todos");
    expect(resolution.apiKeyTier).toBe("env");
  });

  test("the keychain supplies BOTH halves when the process has no environment (#1513)", () => {
    const reader = {
      platform: "darwin",
      run(args: readonly string[]) {
        const service = args[args.indexOf("-s") + 1];
        if (service === "hasna.credentials.todos.api-url") {
          return { status: 0, stdout: "https://api.example.test/todos\n" };
        }
        if (service === "hasna.credentials.todos.api-key") return { status: 0, stdout: "keychain-key\n" };
        return { status: 44, stdout: "" };
      },
    };
    const resolution = resolveClientTransport("todos", { HASNA_STATION: "station03" }, { keychain: { reader } });
    expect(resolution.baseUrl).toBe("https://api.example.test/todos/v1");
    expect(resolution.apiUrlSource).toBe("keychain:hasna.credentials.todos.api-url");
    expect(resolution.apiKeySource).toBe("keychain:hasna.credentials.todos.api-key");
    expect(resolution.apiKeyTier).toBe("keychain");
    expect(JSON.stringify(resolution)).not.toContain("keychain-key");

    // An environment authority still wins over the keychain one.
    const fromEnv = resolveClientTransport(
      "todos",
      { HASNA_STATION: "station03", HASNA_TODOS_API_URL: "https://todos.example.test" },
      { keychain: { reader } },
    );
    expect(fromEnv.baseUrl).toBe("https://todos.example.test/v1");
    expect(fromEnv.apiUrlSource).toBe("HASNA_TODOS_API_URL");
  });

  test("conflicting authority aliases fail closed", () => {
    expect(() =>
      resolveClientTransport("todos", {
        ...validEnv,
        TODOS_API_URL: "https://other.example.test",
      }),
    ).toThrow(/disagree/);
  });

  test("retired storage/mode selectors cannot select a backend", () => {
    for (const key of ["HASNA_TODOS_MODE", "HASNA_TODOS_STORAGE_MODE", "TODOS_MODE", "TODOS_STORAGE_MODE"]) {
      for (const value of ["sqlite", "local", "cloud", "postgresql", ""]) {
        expect(resolveClientTransport("todos", { ...validEnv, [key]: value }).transport).toBe("http");
        expect(() => resolveClientTransport("todos", { [key]: value })).toThrow(/API_URL/);
      }
    }
  });

  test("successful resolution exposes sources but never secret values", () => {
    const resolution = resolveClientTransport("todos", validEnv);
    expect(resolution).toMatchObject({
      transport: "http",
      baseUrl: "https://todos.example.test/v1",
      transportSource: "HASNA_TODOS_API_URL",
      apiKeySource: "HASNA_TODOS_API_KEY",
      apiKeyPresent: true,
      misconfigured: false,
    });
    expect(JSON.stringify(resolution)).not.toContain("test-key");
  });

  test("production authorities require HTTPS; exact loopback HTTP is bounded", () => {
    expect(toV1BaseUrl("https://api.example.test/root/")).toBe("https://api.example.test/root/v1");
    expect(toV1BaseUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787/v1");
    expect(toV1BaseUrl("http://localhost:8787")).toBe("http://localhost:8787/v1");
    expect(() => toV1BaseUrl("http://api.example.test")).toThrow(/loopback/);
    expect(() => toV1BaseUrl("http://127.0.0.1.example.test")).toThrow(/loopback/);
  });

  test("rejects credentials, controls, fragments, queries, IDNs, and non-canonical ports in URLs", () => {
    for (const url of [
      "https://user:pass@example.test",
      "https://example.test/path?x=1",
      "https://example.test/path#x",
      "https://xn--bcher-kva.example",
      "https://example.test:0443",
      "https://example.test\n.evil.test",
    ]) {
      expect(() => toV1BaseUrl(url)).toThrow();
    }
  });

  test("built client sends authentication through the sole HTTPS transport", async () => {
    const requests: Request[] = [];
    const wired = createClientTransport("todos", validEnv, {
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({ ok: true });
      },
      retry: false,
    });
    expect(wired.transport).toBe("http");
    await wired.client.get("/items");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://todos.example.test/v1/items");
    expect(requests[0]?.headers.get("x-api-key")).toBe("test-key");
  });
});

describe("HTTP transport security and request behavior", () => {
  test("appends encoded query values without changing the authority", () => {
    expect(appendQuery("/items", { q: "a b", page: 2, active: true, omitted: null })).toBe(
      "/items?q=a+b&page=2&active=true",
    );
  });

  test("never follows cross-authority redirects", async () => {
    const seen: string[] = [];
    const transport = createHasnaHttpTransport({
      name: "todos",
      baseUrl: "https://todos.example.test/v1",
      apiKey: "key",
      fetchImpl: async (input) => {
        seen.push(String(input));
        return new Response(null, { status: 302, headers: { location: "https://evil.test/steal" } });
      },
      retry: false,
    });
    await expect(transport.get("/items")).rejects.toBeInstanceOf(HasnaHttpError);
    expect(seen).toEqual(["https://todos.example.test/v1/items"]);
  });

  test("401 and 403 are terminal even when generic retry is enabled", async () => {
    for (const status of [401, 403]) {
      let calls = 0;
      const transport = createHasnaHttpTransport({
        name: "todos",
        baseUrl: "https://todos.example.test/v1",
        apiKey: "key",
        fetchImpl: async () => {
          calls += 1;
          return Response.json({ error: "denied" }, { status });
        },
        retry: { retries: 3, retryStatuses: [status], baseDelayMs: 1, maxDelayMs: 1 },
        sleepImpl: async () => {},
      });
      await expect(transport.get("/items")).rejects.toBeInstanceOf(HasnaHttpError);
      expect(calls).toBe(1);
    }
  });

  test("auth failures discard echoed credentials from every diagnostic surface", async () => {
    const key = "fixture-auth-response-echo-key";
    for (const status of [401, 403]) {
      const transport = createHasnaHttpTransport({
        name: "todos",
        baseUrl: "https://todos.example.test/v1",
        apiKey: key,
        retry: false,
        fetchImpl: async () => Response.json({ error: "denied", echoed: { credential: key } }, { status }),
      });

      let thrown: unknown;
      try {
        await transport.get("/items");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HasnaHttpError);
      const authError = thrown as HasnaHttpError;
      expect(authError.body).toBeUndefined();
      expect(Object.keys(authError)).not.toContain("body");
      expect(JSON.stringify(authError)).not.toContain(key);
      expect(JSON.stringify({ ...authError })).not.toContain(key);
      expect(Bun.inspect(authError)).not.toContain(key);
      expect(authError.message).not.toContain(key);
      expect(authError.stack).not.toContain(key);
    }
  });

  test("retries a transient GET without changing credentials mid-request", async () => {
    let calls = 0;
    const keys: string[] = [];
    const transport = createHasnaHttpTransport({
      name: "todos",
      baseUrl: "https://todos.example.test/v1",
      apiKey: () => ({
        apiKey: `key-${++calls}`,
        tier: "argument",
        source: "test",
        deliberate: true,
        diskCandidates: [],
        warning: null,
      }),
      fetchImpl: async (_input, init) => {
        keys.push(new Headers(init?.headers).get("x-api-key") ?? "");
        return keys.length === 1 ? Response.json({}, { status: 503 }) : Response.json({ ok: true });
      },
      retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 1 },
      sleepImpl: async () => {},
    });
    expect(await transport.get<{ ok: boolean }>("/items")).toEqual({ ok: true });
    expect(keys).toEqual(["key-1", "key-1"]);
    expect(calls).toBe(1);
  });
});
