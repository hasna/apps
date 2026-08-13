import { afterEach, describe, expect, test } from "bun:test";
import { resolveClientTransport, resolveStorageClient, createHttpTransport, createStorageClient } from "./http-storage.js";

describe("calendar client-flip resolver", () => {
  test("defaults to local when no env is set", () => {
    const r = resolveClientTransport("calendar", {});
    expect(r.transport).toBe("local");
    expect(r.baseUrl).toBeNull();
  });

  test("local mode never routes to cloud even with url+key", () => {
    const r = resolveClientTransport("calendar", {
      HASNA_CALENDAR_STORAGE_MODE: "local",
      HASNA_CALENDAR_API_URL: "https://calendar.hasna.xyz",
      HASNA_CALENDAR_API_KEY: "k",
    });
    expect(r.transport).toBe("local");
  });

  test("self_hosted + api url + api key => cloud-http at /v1", () => {
    const r = resolveClientTransport("calendar", {
      HASNA_CALENDAR_STORAGE_MODE: "self_hosted",
      HASNA_CALENDAR_API_URL: "https://calendar.hasna.xyz",
      HASNA_CALENDAR_API_KEY: "k",
    });
    expect(r.transport).toBe("cloud-http");
    expect(r.baseUrl).toBe("https://calendar.hasna.xyz/v1");
    expect(r.apiKeyPresent).toBe(true);
  });

  test("self_hosted defaults host from app name when API_URL missing", () => {
    const r = resolveClientTransport("calendar", {
      HASNA_CALENDAR_STORAGE_MODE: "self_hosted",
      HASNA_CALENDAR_API_KEY: "k",
    });
    expect(r.transport).toBe("cloud-http");
    expect(r.baseUrl).toBe("https://calendar.hasna.xyz/v1");
  });

  test("self_hosted without api key is misconfigured and resolveStorageClient throws", () => {
    const r = resolveClientTransport("calendar", { HASNA_CALENDAR_STORAGE_MODE: "self_hosted" });
    expect(r.transport).toBe("local");
    expect(r.misconfigured).toBe(true);
    expect(() => resolveStorageClient("calendar", { HASNA_CALENDAR_STORAGE_MODE: "self_hosted" })).toThrow();
  });

  test("resolveStorageClient returns local client:null when unset", () => {
    const r = resolveStorageClient("calendar", {});
    expect(r.transport).toBe("local");
    expect(r.client).toBeNull();
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
    return createStorageClient("calendar", createHttpTransport({ name: "calendar", baseUrl: "https://calendar.hasna.xyz/v1", apiKey: "secret", fetchImpl: mockFetch }));
  }

  test("create sends bearer + api key + idempotency key and unwraps envelope", async () => {
    const res = await client().create<{ event: { id: string } }>("events", { title: "Standup" });
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://calendar.hasna.xyz/v1/events");
    expect(call.headers["authorization"]).toBe("Bearer secret");
    expect(call.headers["x-api-key"]).toBe("secret");
    expect(call.headers["idempotency-key"]).toBeTruthy();
    expect((res as any).event.id).toBe("e1");
  });

  test("list issues GET /v1/events", async () => {
    await client().list("events", { query: { limit: 5 } });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://calendar.hasna.xyz/v1/events?limit=5");
  });

  test("get returns null on 404", async () => {
    const c = createStorageClient("calendar", createHttpTransport({
      name: "calendar", baseUrl: "https://calendar.hasna.xyz/v1", apiKey: "s",
      fetchImpl: () => Promise.resolve(new Response("{}", { status: 404 })),
    }));
    expect(await c.get("events", "missing")).toBeNull();
  });

  test("delete issues DELETE /v1/events/:id", async () => {
    await client().delete("events", "e1");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("https://calendar.hasna.xyz/v1/events/e1");
  });
});
