import { describe, expect, test } from "bun:test";

import type { Domain } from "./domain-records.js";
import { ApiStore, LocalStore, getStore, isCloudStore } from "./store.js";

function domain(overrides: Partial<Domain> = {}): Domain {
  return {
    id: "domain-1",
    name: "example.com",
    registrar: null,
    status: "active",
    registered_at: null,
    expires_at: null,
    auto_renew: true,
    is_premium: false,
    premium_price: null,
    standard_price: null,
    purchase_price: null,
    purchase_date: null,
    nameservers: [],
    whois: {},
    ssl_expires_at: null,
    ssl_issuer: null,
    notes: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type ClientOverrides = {
  create?: (resource: string, input: unknown) => Promise<unknown>;
  get?: (resource: string, id: string) => Promise<unknown>;
  list?: (resource: string, options?: unknown) => Promise<unknown>;
  update?: (resource: string, id: string, input: unknown) => Promise<unknown>;
  delete?: (resource: string, id: string) => Promise<unknown>;
  transport?: {
    get?: (path: string, options?: unknown) => Promise<unknown>;
    post?: (path: string, body?: unknown) => Promise<unknown>;
    put?: (path: string, body?: unknown) => Promise<unknown>;
    del?: (path: string, options?: unknown) => Promise<unknown>;
  };
};

function apiStore(overrides: ClientOverrides = {}): ApiStore {
  const missing = async () => {
    throw new Error("Unexpected fake client call");
  };
  const transport = {
    get: overrides.transport?.get ?? missing,
    post: overrides.transport?.post ?? missing,
    put: overrides.transport?.put ?? missing,
    del: overrides.transport?.del ?? missing,
  };
  return new ApiStore({
    create: overrides.create ?? missing,
    get: overrides.get ?? missing,
    list: overrides.list ?? missing,
    update: overrides.update ?? missing,
    delete: overrides.delete ?? missing,
    transport,
  } as never);
}

describe("ApiStore domains", () => {
  test("uses the bounded server path and drops nullish query values", async () => {
    const expected = domain();
    const calls: unknown[] = [];
    const store = apiStore({
      list: async (resource, options) => {
        calls.push([resource, options]);
        return { items: [], raw: { domains: [expected] } };
      },
    });

    expect(await store.listDomains({ search: "example", limit: 1, offset: 0 })).toEqual([expected]);
    expect(calls).toEqual([["domains", { query: { search: "example", limit: 1, offset: 0 } }]]);
  });

  test("paginates before applying client-only filters, offset, and limit", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => domain({
      id: `domain-${index}`,
      name: `${String(index).padStart(4, "0")}.com`,
      registrar: index === 999 ? "Wanted" : "Other",
      is_premium: index === 999,
    }));
    const final = domain({ id: "final", name: "final.com", registrar: "Wanted", is_premium: true });
    const offsets: number[] = [];
    const store = apiStore({
      list: async (_resource, options) => {
        const query = (options as { query: { offset: number } }).query;
        offsets.push(query.offset);
        const domains = query.offset === 0 ? firstPage : [final];
        return { items: domains, raw: undefined };
      },
    });

    expect(await store.listDomains({ registrar: "Wanted", is_premium: true, offset: 1, limit: 1 })).toEqual([final]);
    expect(offsets).toEqual([0, 1000]);
  });

  test("returns empty bounded and filtered results", async () => {
    const store = apiStore({ list: async () => ({ items: [], raw: {} }) });

    expect(await store.listDomains({ limit: 0 })).toEqual([]);
    expect(await store.listDomains({ registrar: "Missing" })).toEqual([]);
  });

  test("resolves identifiers and details, including missing resources", async () => {
    const expected = domain({ id: "id/with space" });
    const paths: string[] = [];
    const store = apiStore({
      get: async (_resource, id) => id === expected.id ? expected : null,
      list: async () => ({ items: [expected], raw: undefined }),
      transport: {
        get: async (path) => {
          paths.push(path);
          return path.endsWith("/offers") ? { offers: [{ id: "offer-1" }] } : { emails: [{ id: "email-1" }] };
        },
      },
    });

    expect(await store.getDomainByIdentifier(expected.id)).toEqual(expected);
    expect(await store.getDomainByIdentifier("example.com")).toEqual(expected);
    expect(await store.getDomainDetails(expected.id)).toEqual({
      domain: expected,
      offers: [{ id: "offer-1" }],
      emails: [{ id: "email-1" }],
    });
    expect(paths).toEqual([
      "/domains/id%2Fwith%20space/offers",
      "/domains/id%2Fwith%20space/emails",
    ]);

    const missing = apiStore({
      get: async () => null,
      list: async () => ({ items: [], raw: undefined }),
    });
    expect(await missing.getDomainByName("missing.test")).toBeNull();
    expect(await missing.getDomainDetails("missing.test")).toBeNull();
  });

  test("guards update and delete when the domain is missing", async () => {
    const mutations: string[] = [];
    const missing = apiStore({
      get: async () => null,
      update: async () => { mutations.push("update"); return domain(); },
      delete: async () => { mutations.push("delete"); },
    });

    expect(await missing.updateDomain("missing", { notes: "no" })).toBeNull();
    expect(await missing.deleteDomain("missing")).toBe(false);
    expect(mutations).toEqual([]);

    const existing = domain();
    const present = apiStore({
      get: async () => existing,
      update: async (_resource, _id, input) => ({ ...existing, ...(input as object) }),
      delete: async (_resource, id) => { mutations.push(id); },
    });
    expect((await present.updateDomain(existing.id, { notes: "changed" }))?.notes).toBe("changed");
    expect(await present.deleteDomain(existing.id)).toBe(true);
    expect(mutations).toEqual([existing.id]);
  });

  test("filters invalid and out-of-window expiry values and sorts valid dates", async () => {
    const now = Date.now();
    const soon = new Date(now + 60_000).toISOString();
    const later = new Date(now + 120_000).toISOString();
    const past = new Date(now - 60_000).toISOString();
    const records = [
      domain({ id: "later", expires_at: later, ssl_expires_at: later }),
      domain({ id: "missing" }),
      domain({ id: "invalid", expires_at: "invalid", ssl_expires_at: "invalid" }),
      domain({ id: "past", expires_at: past, ssl_expires_at: past }),
      domain({ id: "soon", expires_at: soon, ssl_expires_at: soon }),
    ];
    const store = apiStore({ list: async () => ({ items: records, raw: undefined }) });

    // Two-sided by default: "past" is already over the line and IS reported.
    // This assertion previously read ["soon", "later"], which encoded the very
    // blind spot being fixed — the ApiStore filter was floored at `now`, so a
    // lapsed name could never be returned. Invalid and absent dates are still
    // filtered out, and ordering is still by date.
    expect((await store.listExpiring(1)).map(({ id }) => id)).toEqual(["past", "soon", "later"]);
    expect((await store.listSslExpiring(1)).map(({ id }) => id)).toEqual(["past", "soon", "later"]);

    // Negative control: the forward-only window still excludes the lapsed name,
    // so the two code paths remain distinguishable.
    expect((await store.listExpiring(1, { includeLapsed: false })).map(({ id }) => id)).toEqual(["soon", "later"]);
    expect((await store.listSslExpiring(1, { includeLapsed: false })).map(({ id }) => id)).toEqual(["soon", "later"]);

    // And the lapsed-only view returns exactly the lapsed name.
    expect((await store.listPastExpiry()).map(({ id }) => id)).toEqual(["past"]);
    expect((await store.listSslPastExpiry()).map(({ id }) => id)).toEqual(["past"]);
  });

  test("applies acquisition defaults and returns null for unknown domains", async () => {
    const discovered = domain({ status: "discovered", standard_price: 12, notes: "keep", expires_at: "2030-01-01" });
    const updates: unknown[] = [];
    const store = apiStore({
      get: async () => discovered,
      update: async (_resource, _id, input) => {
        updates.push(input);
        return { ...discovered, ...(input as object) };
      },
    });

    expect((await store.markDomainPremium(discovered.id, 5000))?.status).toBe("premium_only");
    expect((await store.updateDomainLifecycleStatus(discovered.id, "active"))?.notes).toBe("keep");
    expect((await store.recordDomainPurchase(discovered.id, { price: 1000, registrar: "Broker" }))?.status).toBe("purchased");
    expect(updates).toHaveLength(3);

    const missing = apiStore({
      get: async () => null,
      list: async () => ({ items: [], raw: undefined }),
    });
    expect(await missing.markDomainPremium("missing", 1)).toBeNull();
    expect(await missing.updateDomainLifecycleStatus("missing", "active")).toBeNull();
    expect(await missing.recordDomainPurchase("missing", { price: 1, registrar: "none" })).toBeNull();
  });
});

describe("ApiStore nested resources", () => {
  test("encodes nested routes, strips parent ids from bodies, and handles absent arrays", async () => {
    const calls: unknown[] = [];
    const store = apiStore({
      transport: {
        post: async (path, body) => { calls.push(["post", path, body]); return { id: "created" }; },
        get: async (path, options) => { calls.push(["get", path, options]); return {}; },
      },
    });

    expect(await store.createDomainOffer({ domain_id: "a/b", our_offer: 10 })).toEqual({ id: "created" });
    expect(await store.linkDomainEmail({ domain_id: "a/b", email_id: "email", type: "offer" })).toEqual({ id: "created" });
    expect(await store.createDnsRecord({ domain_id: "a/b", type: "A", name: "@", value: "127.0.0.1" })).toEqual({ id: "created" });
    expect(await store.listDomainOffers("a/b")).toEqual([]);
    expect(await store.listDomainEmailLinks("a/b")).toEqual([]);
    expect(await store.listDnsRecords("a/b")).toEqual([]);
    expect(calls[0]).toEqual(["post", "/domains/a%2Fb/offers", { our_offer: 10 }]);
    expect(calls[1]).toEqual(["post", "/domains/a%2Fb/emails", { email_id: "email", type: "offer" }]);
    expect(calls[2]).toEqual(["post", "/domains/a%2Fb/dns", { type: "A", name: "@", value: "127.0.0.1" }]);
  });

  test("converts nested lookup refusals to null", async () => {
    const refused = apiStore({ transport: { get: async () => { throw new Error("forbidden"); } } });

    expect(await refused.getDomainOffer("secret")).toBeNull();
    expect(await refused.getDomainEmailLink("secret")).toBeNull();
    expect(await refused.getDomainReputation("secret")).toBeNull();
  });

  test("guards missing nested mutations and preserves boolean delete results", async () => {
    const deleted: string[] = [];
    const missing = apiStore({
      get: async () => null,
      delete: async (resource) => { deleted.push(resource); },
      transport: { del: async () => ({ deleted: 0 }) },
    });

    expect(await missing.updateDnsRecord("missing", { ttl: 60 })).toBeNull();
    expect(await missing.deleteDnsRecord("missing")).toBe(false);
    expect(await missing.deleteAlert("missing")).toBe(false);
    expect(await missing.updateDomainOwner("missing", { owner_name: "Owner" })).toBeNull();
    expect(await missing.deleteDomainOwner("missing")).toBe(false);
    expect(await missing.deleteHistoryEntry("missing")).toBe(false);
    expect(await missing.deleteHistoryByDomain("missing")).toBe(false);
    expect(deleted).toEqual([]);
  });
});

describe("store resolution", () => {
  test("no hosted env and no local opt-in FAILS CLOSED instead of serving local sqlite", () => {
    // The owner ruling: without the API env the client must never silently
    // fall back to the default local database. getStore AND isCloudStore throw
    // so a bare `false` can never be read as a licence to open sqlite.
    expect(() => getStore({})).toThrow(/HASNA_DOMAINS_API_URL/);
    expect(() => getStore({})).toThrow(/HASNA_DOMAINS_API_KEY/);
    expect(() => getStore({})).toThrow(/fails closed/);
    expect(() => isCloudStore({})).toThrow(/HASNA_DOMAINS_API_URL/);
  });

  test("an explicit local path opt-in still resolves a LocalStore", () => {
    // Local mode survives strictly as an explicit opt-in: a local path var
    // names the database the operator actually wants.
    expect(getStore({ DOMAINS_DB_PATH: "/tmp/scratch.db" })).toBeInstanceOf(LocalStore);
    expect(getStore({ HASNA_DOMAINS_DIR: "/tmp/domains" })).toBeInstanceOf(LocalStore);
    expect(isCloudStore({ DOMAINS_DB_PATH: "/tmp/scratch.db" })).toBe(false);
  });

  test("supports the unprefixed DOMAINS_API_URL/key aliases", () => {
    const aliased = { DOMAINS_API_URL: "https://api.example", DOMAINS_API_KEY: "secret" };
    expect(isCloudStore({ ...aliased, NODE_ENV: "production" })).toBe(true);
  });

  test("refuses a partial hosted config (URL without key)", () => {
    expect(() => getStore({ HASNA_DOMAINS_API_URL: "https://api.example" })).toThrow(
      /Misconfigured domains client/,
    );
  });

  test("refuses a partial hosted config (key without URL)", () => {
    expect(() => getStore({ HASNA_DOMAINS_API_KEY: "secret" })).toThrow(
      /Misconfigured domains client/,
    );
  });
});
