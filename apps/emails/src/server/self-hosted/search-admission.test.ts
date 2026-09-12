import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import type { TypedQueryClient } from "../../storage-kit/index.js";
import { EmailsSelfHostedStore } from "./store.js";
import { handleSelfHostedRequest, type SelfHostedServiceDeps } from "./service.js";
import { testAuthDeps } from "./auth/test-support.js";

const SIGNING_SECRET = "test-signing-secret-do-not-use-in-prod";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function fixture(cancelSearch = false) {
  const gate = deferred<never[]>();
  const started = deferred<void>();
  let searchCalls = 0;
  const client: TypedQueryClient = {
    async query(sql, params) { const rows = await client.many(sql, params); return { rows, rowCount: rows.length }; },
    async many<T>(sql: string): Promise<T[]> {
      if (sql.includes("lower(concat_ws(")) {
        searchCalls++;
        if (cancelSearch) throw { code: "57014" };
        if (searchCalls === 1) { started.resolve(); return gate.promise; }
      }
      return [];
    },
    async get<T>(sql: string): Promise<T | null> { return sql.includes("FROM mailbox_filters") ? { id: "filter-fixture", name: "fixture", normalized_name: "fixture", mailbox: "inbox", criteria: { search: "beta" } } as T : sql.includes("SELECT 1") ? { ok: 1 } as T : null; },
    async one<T>(): Promise<T> { return {} as T; },
    async execute() {},
  };
  const store = new EmailsSelfHostedStore(client);
  const deps: SelfHostedServiceDeps = {
    client, store,
    verifier: verifyApiKey({ app: "emails", signingSecret: SIGNING_SECRET, keyStatus: async () => "active" }),
    sender: { provider: "ses", send: async () => { throw new Error("No test may send mail"); } },
    migrations: [], version: "test",
    ...testAuthDeps(client, SIGNING_SECRET),
  };
  const token = mintApiKey({ app: "emails", scopes: ["emails:read"], signingSecret: SIGNING_SECRET }).token;
  const request = (path: string, authenticated = true) => handleSelfHostedRequest(deps, new Request(`http://test${path}`, {
    method: path.includes("/apply") ? "POST" : "GET",
    headers: authenticated ? { "x-api-key": token } : {},
  }));
  return { store, gate, started, request, calls: () => searchCalls };
}

describe("message search admission through real store and handler", () => {
  test("two tenant stores share admission while plain reads remain available", async () => {
    const f = fixture();
    const first = f.store.forTenant("00000000-0000-0000-0000-000000000001").listMessages({ search: "alpha" });
    await f.started.promise;
    try {
      await expect(f.store.forTenant("00000000-0000-0000-0000-000000000002").listMessages({ search: "beta" })).rejects.toMatchObject({ name: "MessageSearchBusyError" });
      expect(await f.store.forTenant("00000000-0000-0000-0000-000000000002").listMessages({ folder: "inbox", limit: 1 })).toEqual({ items: [], next_cursor: null });
      expect(f.calls()).toBe(1);
    } finally { f.gate.resolve([]); await first; }
    expect(await f.store.forTenant("00000000-0000-0000-0000-000000000002").listMessages({ search: "beta" })).toEqual({ items: [], next_cursor: null });
  });
  test("busy searches return429 for q/search and both route aliases; normal reads and authentication retain their behavior", async () => {
    const f = fixture();
    const first = f.request("/v1/messages?q=alpha");
    await f.started.promise;
    try {
      for (const path of ["/v1/messages", "/api/v1/messages"]) {
        for (const query of ["q=beta", "search=beta", "q=beta&search="]) {
          const response = (await f.request(`${path}?${query}`))!;
          expect(response.status).toBe(429);
          expect(response.headers.get("Retry-After")).toBe("5");
          expect((await response.json()).code).toBe("search_busy");
        }
        for (const query of ["folder=inbox&limit=1", "q=&search=beta", "q=%20%20"]) {
          const response = (await f.request(`${path}?${query}`))!;
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ messages: [], next_cursor: null });
        }
        expect((await f.request(`${path}?q=beta`, false))!.status).toBe(401);
      }
      for (const prefix of ["/v1", "/api/v1"]) {
        const response = (await f.request(`${prefix}/mailbox-filters/fixture/apply`))!;
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ error: "Message search is busy; retry later.", code: "search_busy", retry_after: 5 });
      }
      expect((await f.request("/health", false))!.status).toBe(200);
      expect(f.calls()).toBe(1);
    } finally { f.gate.resolve([]); expect((await first)!.status).toBe(200); }
  });
});

test("database search cancellation reaches both HTTP operations and aliases as an explicit 504", async () => {
  const f = fixture(true);
  for (const prefix of ["/v1", "/api/v1"]) {
    for (const suffix of ["/messages?search=alpha", "/mailbox-filters/fixture/apply"]) {
      const response = (await f.request(prefix + suffix))!;
      expect(response.status).toBe(504);
      expect(response.headers.get("Retry-After")).toBe("5");
      expect(await response.json()).toEqual({ error: "Message search exceeded its time limit.", code: "search_timeout", retry_after: 5 });
    }
  }
  expect((await f.request("/v1/messages?limit=1"))!.status).toBe(200);
});
