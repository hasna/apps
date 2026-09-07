// The exact URLs the published ./sdk sends (hasna/apps#1720 validation).
//
// @hasna/contracts' shared transport canonicalises ANY base to `<origin>/v1`
// and joins request paths onto it. The generated client used to send paths that
// ALREADY carried `/v1`, so every hosted call went to `<origin>/v1/v1/...`
// (measured live: listSecrets -> https://api.hasna.com/secrets/v1/v1/secrets
// 404), and the public probes to `<origin>/v1/health` (404 on the serve and on
// the gateway, which answer them at `<origin>/health`). No test pinned a URL.
//
// These tests pin them: once with a stub fetch against the fleet gateway
// authority (no network), and once end to end against a loopback serve-shaped
// server so the pathname assertions do not depend on the stub's own parsing.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SecretsClient } from "../src/sdk.js";

const KEY = "hasna_secrets_fixture_key_0003";

/** Stub fetch that records each request and answers `{}`. */
function recordingFetch(): { fetch: typeof fetch; calls: Array<{ url: string; method: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    calls.push({ url: String(input), method: init?.method ?? "GET", headers });
    return new Response(JSON.stringify({ status: "ok", version: "0.0.0", mode: "api", secrets: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe("SDK request URLs against the fleet gateway authority", () => {
  for (const base of ["https://api.hasna.com/secrets", "https://api.hasna.com/secrets/", "https://api.hasna.com/secrets/v1"]) {
    it(`base ${base}: data routes go under /v1 exactly once, probes go to the origin path`, async () => {
      const { fetch, calls } = recordingFetch();
      const client = new SecretsClient({ baseUrl: base, apiKey: KEY, fetch });
      expect(client.baseUrl).toBe("https://api.hasna.com/secrets/v1");

      await client.listSecrets();
      await client.getSecret({ key: "example/service/dev/api_key" });
      await client.listUsers();
      await client.listItems();
      await client.listAudit({ limit: 5 });
      await client.version();
      await client.health();
      await client.ready();

      const urls = calls.map((c) => c.url.split("?")[0]);
      expect(urls).toEqual([
        "https://api.hasna.com/secrets/v1/secrets",
        "https://api.hasna.com/secrets/v1/secrets/get",
        "https://api.hasna.com/secrets/v1/users",
        "https://api.hasna.com/secrets/v1/items",
        "https://api.hasna.com/secrets/v1/audit",
        "https://api.hasna.com/secrets/version",
        "https://api.hasna.com/secrets/health",
        "https://api.hasna.com/secrets/ready",
      ]);
      expect(calls[1]!.url).toContain("?key=example%2Fservice%2Fdev%2Fapi_key");
      for (const url of urls) expect(url).not.toContain("/v1/v1");

      // Authenticated data routes carry the key both ways; the PUBLIC probes
      // (`security: []` in the contract) carry no credential at all.
      for (const call of calls.slice(0, 5)) {
        expect(call.headers["x-api-key"]).toBe(KEY);
        expect(call.headers["authorization"]).toBe(`Bearer ${KEY}`);
      }
      for (const call of calls.slice(5)) {
        expect(call.headers["x-api-key"]).toBeUndefined();
        expect(call.headers["authorization"]).toBeUndefined();
        expect(JSON.stringify(call.headers)).not.toContain(KEY);
      }
    });
  }

  it("a probe follows no redirect and surfaces a non-2xx as ApiError", async () => {
    const fetchImpl = (async () => new Response("moved", { status: 302, headers: { location: "https://elsewhere.example/" } })) as unknown as typeof fetch;
    const client = new SecretsClient({ baseUrl: "https://api.hasna.com/secrets", apiKey: KEY, fetch: fetchImpl });
    await expect(client.health()).rejects.toMatchObject({ name: "ApiError", status: 302 });
  });
});

describe("SDK request pathnames end to end against a serve-shaped loopback", () => {
  let server: ReturnType<typeof Bun.serve>;
  const seen: Array<{ method: string; pathname: string; search: string; hasAuth: boolean }> = [];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        seen.push({ method: req.method, pathname: url.pathname, search: url.search, hasAuth: req.headers.has("authorization") });
        // The serve's real route table shape: probes above /v1, data under it.
        if (url.pathname === "/health" || url.pathname === "/version" || url.pathname === "/ready") {
          return Response.json({ status: "ok", version: "test", mode: "api" });
        }
        if (url.pathname === "/v1/secrets" && req.method === "GET") return Response.json({ secrets: [] });
        if (url.pathname === "/v1/secrets/get") {
          return Response.json({ key: url.searchParams.get("key"), value: "v", type: "api_key" });
        }
        if (url.pathname === "/v1/secrets" && req.method === "POST") {
          return Response.json({ key: "k", type: "api_key", created_at: "", updated_at: "" });
        }
        if (url.pathname === "/v1/items/abc%2Fdef") return Response.json({ id: "abc/def", kind: "custom", title: "t", domains: [], tags: [], favorite: false, created_at: "", updated_at: "", data: {} });
        return Response.json({ error: `unexpected ${req.method} ${url.pathname}` }, { status: 404 });
      },
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  it("every method reaches the route the serve actually mounts", async () => {
    const client = new SecretsClient({ baseUrl: `http://127.0.0.1:${server.port}`, apiKey: KEY });

    await client.version();
    await client.health();
    await client.listSecrets({ namespace: "example" });
    await client.getSecret({ key: "example/service/dev/api_key" });
    await client.putSecret({ key: "example/service/dev/api_key", value: "v", type: "api_key" });
    await client.getItem("abc/def");

    expect(seen.map((s) => [s.method, s.pathname])).toEqual([
      ["GET", "/version"],
      ["GET", "/health"],
      ["GET", "/v1/secrets"],
      ["GET", "/v1/secrets/get"],
      ["POST", "/v1/secrets"],
      ["GET", "/v1/items/abc%2Fdef"],
    ]);
    expect(seen[2]!.search).toBe("?namespace=example");
    expect(seen[3]!.search).toBe("?key=example%2Fservice%2Fdev%2Fapi_key");
    expect(seen.slice(0, 2).every((s) => !s.hasAuth)).toBe(true);
    expect(seen.slice(2).every((s) => s.hasAuth)).toBe(true);
  });
});
