import { describe, expect, test } from "bun:test";

import { ApiError, DomainsClient } from "./client.js";
import { createDomainsClientFromEnv, type CreateDomainsClientOptions } from "./index.js";

type FetchCall = {
  url: URL;
  init: RequestInit;
};

function recordingFetch(calls: FetchCall[], response: () => Response = () => Response.json({ ok: true })): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return response();
  }) as typeof fetch;
}

describe("DomainsClient", () => {
  test("requires a base URL", () => {
    expect(() => new DomainsClient({ baseUrl: "" })).toThrow("DomainsClient requires a baseUrl.");
  });

  test("builds every endpoint request with encoded ids and JSON bodies", async () => {
    const calls: FetchCall[] = [];
    const client = new DomainsClient({
      baseUrl: "https://domains.example/",
      apiKey: "secret",
      headers: { "x-client": "sdk" },
      fetch: recordingFetch(calls),
    });

    await client.getHealth({ headers: { "x-request": "health" } });
    await client.getReady();
    await client.getDnsRecord("dns/id");
    await client.deleteDnsRecord("dns/id");
    await client.listDomains({ search: "a b", limit: 0, status: undefined });
    await client.createDomain({ name: "example.com" });
    await client.getDomain("domain/id");
    await client.deleteDomain("domain/id");
    await client.updateDomain("domain/id", { notes: null });
    await client.listDnsRecords("domain/id");
    await client.createDnsRecord("domain/id", { type: "A", name: "@", value: "127.0.0.1" });
    await client.listOffers("domain/id");
    await client.createOffer("domain/id", { our_offer: 100 });
    await client.getDomainStats();
    await client.getVersion();

    expect(calls.map(({ url, init }) => [init.method, url.pathname])).toEqual([
      ["GET", "/health"],
      ["GET", "/ready"],
      ["GET", "/v1/dns/dns%2Fid"],
      ["DELETE", "/v1/dns/dns%2Fid"],
      ["GET", "/v1/domains"],
      ["POST", "/v1/domains"],
      ["GET", "/v1/domains/domain%2Fid"],
      ["DELETE", "/v1/domains/domain%2Fid"],
      ["PATCH", "/v1/domains/domain%2Fid"],
      ["GET", "/v1/domains/domain%2Fid/dns"],
      ["POST", "/v1/domains/domain%2Fid/dns"],
      ["GET", "/v1/domains/domain%2Fid/offers"],
      ["POST", "/v1/domains/domain%2Fid/offers"],
      ["GET", "/v1/stats"],
      ["GET", "/version"],
    ]);
    expect(calls[4]!.url.searchParams.toString()).toBe("search=a+b&limit=0");
    expect(calls[0]!.init.headers).toEqual({
      Accept: "application/json",
      "x-client": "sdk",
      "x-request": "health",
      "x-api-key": "secret",
    });
    expect(calls[5]!.init.headers).toEqual({
      Accept: "application/json",
      "x-client": "sdk",
      "x-api-key": "secret",
      "Content-Type": "application/json",
    });
    expect(calls[5]!.init.body).toBe('{"name":"example.com"}');
    expect(calls[8]!.init.body).toBe('{"notes":null}');
    expect(calls[10]!.init.body).toBe('{"type":"A","name":"@","value":"127.0.0.1"}');
    expect(calls[12]!.init.body).toBe('{"our_offer":100}');
  });

  test("returns parsed JSON, plain text, and undefined empty responses", async () => {
    const responses = [
      Response.json({ status: "ok", version: "1", mode: "local" }),
      new Response("plain response"),
      new Response(null, { status: 204 }),
    ];
    const client = new DomainsClient({
      baseUrl: "https://domains.example",
      fetch: recordingFetch([], () => responses.shift()!),
    });

    expect(await client.getHealth()).toEqual({ status: "ok", version: "1", mode: "local" });
    expect(await client.getVersion()).toBe("plain response" as never);
    expect(await client.deleteDomain("id")).toBeUndefined();
  });

  test("omits optional authentication and preserves request init options", async () => {
    const calls: FetchCall[] = [];
    const client = new DomainsClient({
      baseUrl: "https://domains.example",
      fetch: recordingFetch(calls),
    });

    await client.getReady({ cache: "no-store", headers: { "x-request": "ready" } });

    expect(calls[0]!.init.cache).toBe("no-store");
    expect(calls[0]!.init.headers).toEqual({ Accept: "application/json", "x-request": "ready" });
  });

  test("throws ApiError with parsed auth refusal details", async () => {
    const body = { error: "unauthorized", reason: "invalid API key" };
    const client = new DomainsClient({
      baseUrl: "https://domains.example",
      fetch: recordingFetch([], () => Response.json(body, { status: 401 })),
    });

    try {
      await client.getHealth();
      throw new Error("Expected getHealth to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toBeInstanceOf(Error);
      expect((error as ApiError).name).toBe("ApiError");
      expect((error as ApiError).status).toBe(401);
      expect((error as ApiError).message).toBe("GET /health failed: 401");
      expect((error as ApiError).body).toEqual(body);
    }
  });

  test("retains a non-JSON error body", async () => {
    const client = new DomainsClient({
      baseUrl: "https://domains.example",
      fetch: recordingFetch([], () => new Response("gateway unavailable", { status: 503 })),
    });

    await expect(client.getReady()).rejects.toEqual(expect.objectContaining({
      status: 503,
      body: "gateway unavailable",
      message: "GET /ready failed: 503",
    }));
  });
});

describe("createDomainsClientFromEnv (the /sdk resolver seam)", () => {
  function fromEnv(env: Record<string, string>, overrides: CreateDomainsClientOptions = {}) {
    return createDomainsClientFromEnv(env, overrides);
  }

  test("resolves the environment pair through the shared chain and reports sources", async () => {
    const calls: FetchCall[] = [];
    const client = fromEnv(
      { HASNA_DOMAINS_API_URL: "https://domains.example", HASNA_DOMAINS_API_KEY: "env-key" },
      { fetch: recordingFetch(calls) },
    );

    await client.getHealth();

    expect(calls[0]!.url.href).toBe("https://domains.example/health");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("env-key");
  });

  test("BUG PINNED (#1794): an explicit baseUrl with no apiKey never attaches the ambient fleet key", async () => {
    const calls: FetchCall[] = [];
    // The environment carries a real-looking key and a real-looking URL — the
    // kinds of values a station wrapper injects. The caller pinned ONLY the
    // authority; the ambient key must NOT follow.
    const client = fromEnv(
      { HASNA_DOMAINS_API_KEY: "ambient-key", HASNA_DOMAINS_API_URL: "https://other.example" },
      { baseUrl: "https://pinned.example", fetch: recordingFetch(calls) },
    );

    await client.getReady();

    expect(calls[0]!.url.href).toBe("https://pinned.example/ready");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBeUndefined();
  });

  test("an explicit baseUrl with an explicit apiKey pins BOTH", async () => {
    const calls: FetchCall[] = [];
    const client = fromEnv(
      { HASNA_DOMAINS_API_KEY: "ambient-key" },
      { baseUrl: "https://pinned.example", apiKey: "pinned-key", fetch: recordingFetch(calls) },
    );

    await client.getReady();

    expect(calls[0]!.url.href).toBe("https://pinned.example/ready");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("pinned-key");
  });

  test("no resolvable credential throws — the SDK never degrades to an anonymous client", () => {
    expect(() => fromEnv({ HASNA_DOMAINS_API_URL: "https://domains.example" })).toThrow(/no API key could be resolved/);
    expect(() => fromEnv({})).toThrow(/HASNA_DOMAINS_API_URL is not set/);
  });

  test("a key alone resolves the fleet gateway default", async () => {
    const calls: FetchCall[] = [];
    const client = fromEnv({ HASNA_DOMAINS_API_KEY: "env-key" }, { fetch: recordingFetch(calls) });

    await client.listDomains();

    expect(calls[0]!.url.origin + calls[0]!.url.pathname).toBe("https://api.hasna.com/domains/v1/domains");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("env-key");
  });
});
