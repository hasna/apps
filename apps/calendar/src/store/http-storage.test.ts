import { afterEach, describe, expect, test } from "bun:test";
import { resolveClientTransport, resolveStorageClient, createHttpTransport, createStorageClient } from "./http-storage.js";

describe("calendar client transport resolver (env-selection contract)", () => {
  test("fails closed when no env is set", () => {
    const r = resolveClientTransport("calendar", {});
    expect(r.transport).toBe("unconfigured");
    expect(r.baseUrl).toBeNull();
    expect(r.misconfigured).toBe(true);
    expect(r.warning).toContain("required");
  });

  test("API URL + API key => http-api at /v1", () => {
    const r = resolveClientTransport("calendar", {
      HASNA_CALENDAR_API_URL: "https://calendar.example.test",
      HASNA_CALENDAR_API_KEY: "k",
    });
    expect(r.transport).toBe("http-api");
    expect(r.baseUrl).toBe("https://calendar.example.test/v1");
    expect(r.apiKeyPresent).toBe(true);
    expect(r.apiUrlSource).toBe("HASNA_CALENDAR_API_URL");
    expect(r.apiKeySource).toBe("HASNA_CALENDAR_API_KEY");
    expect(r.apiKeyTier).toBe("env");
    expect(r.misconfigured).toBe(false);
  });

  test("the CALENDAR_ alias pair routes to http-api too", () => {
    const r = resolveClientTransport("calendar", {
      CALENDAR_API_URL: "https://calendar.example.com",
      CALENDAR_API_KEY: "k",
    });
    expect(r.transport).toBe("http-api");
    expect(r.baseUrl).toBe("https://calendar.example.com/v1");
  });

  test("API URL WITHOUT key is misconfigured and resolveStorageClient throws (fail-closed)", () => {
    const r = resolveClientTransport("calendar", { HASNA_CALENDAR_API_URL: "https://calendar.example.test" });
    expect(r.transport).toBe("unconfigured");
    expect(r.misconfigured).toBe(true);
    expect(r.warning).toContain("HASNA_CALENDAR_API_KEY");
    expect(() => resolveStorageClient("calendar", { HASNA_CALENDAR_API_URL: "https://calendar.example.test" })).toThrow();
    expect(() => resolveStorageClient("calendar", { HASNA_CALENDAR_API_URL: "https://calendar.example.test" })).toThrow(/HASNA_CALENDAR_API_KEY is required/);
  });

  test("API key WITHOUT URL resolves the fleet gateway (a key alone is complete)", () => {
    const r = resolveClientTransport("calendar", { HASNA_CALENDAR_API_KEY: "k" });
    expect(r.transport).toBe("http-api");
    expect(r.baseUrl).toBe("https://api.hasna.com/calendar/v1");
    expect(r.apiUrlSource).toBe("default");
    expect(r.misconfigured).toBe(false);
    const resolved = resolveStorageClient("calendar", { HASNA_CALENDAR_API_KEY: "k" });
    expect(resolved.client.baseUrl).toBe("https://api.hasna.com/calendar/v1");
  });

  test("an invalid API URL is misconfigured and resolveStorageClient throws", () => {
    const r = resolveClientTransport("calendar", {
      HASNA_CALENDAR_API_URL: "ftp://calendar.example.test",
      HASNA_CALENDAR_API_KEY: "k",
    });
    expect(r.transport).toBe("unconfigured");
    expect(r.misconfigured).toBe(true);
    expect(() =>
      resolveStorageClient("calendar", {
        HASNA_CALENDAR_API_URL: "ftp://calendar.example.test",
        HASNA_CALENDAR_API_KEY: "k",
      }),
    ).toThrow();
  });

  test("resolveStorageClient refuses absent configuration", () => {
    expect(() => resolveStorageClient("calendar", {})).toThrow(/HASNA_CALENDAR_API_URL is required/);
  });

  test("resolveStorageClient returns a ready client when the pair is set", () => {
    const r = resolveStorageClient("calendar", {
      HASNA_CALENDAR_API_URL: "https://calendar.example.test",
      HASNA_CALENDAR_API_KEY: "k",
    });
    expect(r.transport).toBe("http-api");
    expect(r.client).not.toBeNull();
  });
});

describe("calendar storage client CRUD over mock transport", () => {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = [];
  afterEach(() => (calls.length = 0));

  function mockFetch(url: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body, headers });
    if (method === "POST") return Promise.resolve(new Response(JSON.stringify({ event: { id: "e1", title: body.title } }), { status: 201 }));
    if (method === "GET" && url.endsWith("/events/e1")) return Promise.resolve(new Response(JSON.stringify({ event: { id: "e1", title: "T" }, attendees: [] }), { status: 200 }));
    if (method === "GET") return Promise.resolve(new Response(JSON.stringify({ events: [{ id: "e1" }], count: 1 }), { status: 200 }));
    if (method === "DELETE") return Promise.resolve(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }

  function client() {
    return createStorageClient("calendar", createHttpTransport({ name: "calendar", baseUrl: "https://calendar.example.test/v1", apiKey: "secret", fetchImpl: mockFetch }));
  }

  test("create sends bearer + api key + idempotency key and unwraps envelope", async () => {
    const res = await client().create<{ event: { id: string } }>("events", { title: "Standup" });
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://calendar.example.test/v1/events");
    expect(call.headers["authorization"]).toBe("Bearer secret");
    expect(call.headers["x-api-key"]).toBe("secret");
    expect(call.headers["idempotency-key"]).toBeTruthy();
    expect((res as any).event.id).toBe("e1");
  });

  test("list issues GET /v1/events", async () => {
    await client().list("events", { query: { limit: 5 } });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://calendar.example.test/v1/events?limit=5");
  });

  test("get returns null on 404", async () => {
    const c = createStorageClient("calendar", createHttpTransport({
      name: "calendar", baseUrl: "https://calendar.example.test/v1", apiKey: "s",
      fetchImpl: () => Promise.resolve(new Response("{}", { status: 404 })),
    }));
    expect(await c.get("events", "missing")).toBeNull();
  });

  test("delete issues DELETE /v1/events/:id", async () => {
    await client().delete("events", "e1");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("https://calendar.example.test/v1/events/e1");
  });
});
