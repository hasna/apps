import { afterEach, describe, expect, test } from "bun:test";
import { resolveClientTransport, resolveStorageClient, createHttpTransport, createStorageClient } from "./http-storage.js";

describe("contacts client-flip resolver", () => {
  test("defaults to local when no env is set", () => {
    const r = resolveClientTransport("contacts", {});
    expect(r.transport).toBe("local");
    expect(r.baseUrl).toBeNull();
  });

  test("local mode never routes to cloud even with url+key", () => {
    const r = resolveClientTransport("contacts", {
      HASNA_CONTACTS_STORAGE_MODE: "local",
      HASNA_CONTACTS_API_URL: "https://contacts.hasna.xyz",
      HASNA_CONTACTS_API_KEY: "k",
    });
    expect(r.transport).toBe("local");
  });

  test("self_hosted + api url + api key => cloud-http at /v1", () => {
    const r = resolveClientTransport("contacts", {
      HASNA_CONTACTS_STORAGE_MODE: "self_hosted",
      HASNA_CONTACTS_API_URL: "https://contacts.hasna.xyz",
      HASNA_CONTACTS_API_KEY: "k",
    });
    expect(r.transport).toBe("cloud-http");
    expect(r.baseUrl).toBe("https://contacts.hasna.xyz/v1");
    expect(r.apiKeyPresent).toBe(true);
  });

  test("self_hosted defaults host from app name when API_URL missing", () => {
    const r = resolveClientTransport("contacts", {
      HASNA_CONTACTS_STORAGE_MODE: "self_hosted",
      HASNA_CONTACTS_API_KEY: "k",
    });
    expect(r.transport).toBe("cloud-http");
    expect(r.baseUrl).toBe("https://contacts.hasna.xyz/v1");
  });

  test("self_hosted without api key is misconfigured and resolveStorageClient throws", () => {
    const r = resolveClientTransport("contacts", { HASNA_CONTACTS_STORAGE_MODE: "self_hosted" });
    expect(r.transport).toBe("local");
    expect(r.misconfigured).toBe(true);
    expect(() => resolveStorageClient("contacts", { HASNA_CONTACTS_STORAGE_MODE: "self_hosted" })).toThrow();
  });

  test("resolveStorageClient returns local client:null when unset", () => {
    const r = resolveStorageClient("contacts", {});
    expect(r.transport).toBe("local");
    expect(r.client).toBeNull();
  });
});

describe("contacts storage client CRUD over mock transport", () => {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = [];
  afterEach(() => (calls.length = 0));

  function mockFetch(url: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body, headers });
    if (method === "POST") return Promise.resolve(new Response(JSON.stringify({ contact: { id: "c1", display_name: body.display_name } }), { status: 201 }));
    if (method === "GET" && url.endsWith("/contacts/c1")) return Promise.resolve(new Response(JSON.stringify({ contact: { id: "c1" } }), { status: 200 }));
    if (method === "GET") return Promise.resolve(new Response(JSON.stringify({ contacts: [{ id: "c1" }], count: 1 }), { status: 200 }));
    if (method === "DELETE") return Promise.resolve(new Response(JSON.stringify({ deleted: true, id: "c1" }), { status: 200 }));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }

  function client() {
    return createStorageClient("contacts", createHttpTransport({ name: "contacts", baseUrl: "https://contacts.hasna.xyz/v1", apiKey: "secret", fetchImpl: mockFetch }));
  }

  test("create sends bearer + api key + idempotency key and unwraps envelope", async () => {
    const res = await client().create<{ contact: { id: string } }>("contacts", { display_name: "Alice" });
    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://contacts.hasna.xyz/v1/contacts");
    expect(call.headers["authorization"]).toBe("Bearer secret");
    expect(call.headers["x-api-key"]).toBe("secret");
    expect(call.headers["idempotency-key"]).toBeTruthy();
    expect((res as any).contact.id).toBe("c1");
  });

  test("list issues GET /v1/contacts", async () => {
    await client().list("contacts", { query: { limit: 5 } });
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://contacts.hasna.xyz/v1/contacts?limit=5");
  });

  test("get returns null on 404", async () => {
    const c = createStorageClient("contacts", createHttpTransport({
      name: "contacts", baseUrl: "https://contacts.hasna.xyz/v1", apiKey: "s",
      fetchImpl: () => Promise.resolve(new Response("{}", { status: 404 })),
    }));
    expect(await c.get("contacts", "missing")).toBeNull();
  });

  test("delete issues DELETE /v1/contacts/:id", async () => {
    await client().delete("contacts", "c1");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("https://contacts.hasna.xyz/v1/contacts/c1");
  });
});
