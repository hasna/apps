import { describe, expect, test } from "bun:test";
import { createServeApp } from "./app.js";
import { buildOpenApiDocument } from "./openapi.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";
import { PgShortlinksStore } from "../pg-store.js";
import { LINK_ROUTER_AUTH_HEADER } from "../server.js";

const EDGE_AUTH = ["unit", "test", "edge"].join("-");

// Minimal shims — the serve unit surface (probes + auth gate) never needs a
// real Postgres. checkHealth issues `SELECT 1`; checkReady runs the ledger
// dry-run (ensureLedger CREATE TABLE + a SELECT), both satisfied by the shim.
function fakeClient(): PoolQueryClient {
  const client = {
    async query() {
      return { rows: [{ ok: 1 }], rowCount: 1 };
    },
    async many() {
      return [] as any[];
    },
    async get() {
      return { ok: 1 } as any;
    },
    async one() {
      return { ok: 1 } as any;
    },
    async execute() {},
    async transaction(fn: any) {
      return fn(client);
    },
    async close() {},
    pool: {} as any,
  };
  return client as unknown as PoolQueryClient;
}

function makeApp() {
  const client = fakeClient();
  const store = PgShortlinksStore.fromQueryClient(client);
  return createServeApp({
    client,
    store,
    version: "test",
    backend: "postgresql",
    signingSecret: "unit-test-signing-secret",
    keyStatus: async () => "active" as const,
  });
}

describe("shortlinks serve app", () => {
  test("GET /health returns ok", async () => {
    const res = await makeApp().request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body.version).toBe("test");
    expect(body.backend).toBe("postgresql");
  });

  test("GET /version returns service metadata", async () => {
    const res = await makeApp().request("/version");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("@hasna/shortlinks");
  });

  test("GET /openapi.json serves the OpenAPI document", async () => {
    const res = await makeApp().request("/openapi.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.openapi).toBe("3.0.3");
    expect(body.paths["/v1/links"]).toBeDefined();
  });

  test("GET /v1/links without a key is 401", async () => {
    const res = await makeApp().request("/v1/links");
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.reason).toBe("missing_token");
  });

  test("GET /v1/links with a bogus key is 401", async () => {
    const res = await makeApp().request("/v1/links", { headers: { "x-api-key": "hasna_shortlinks_bogus" } });
    expect(res.status).toBe(401);
  });

  test("DELETE /v1/domains/:hostname without a key is 401", async () => {
    const res = await makeApp().request("/v1/domains/zztest.example", { method: "DELETE" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.reason).toBe("missing_token");
  });
});

describe("shortlinks openapi", () => {
  test("covers the versioned /v1 operations", () => {
    const doc = buildOpenApiDocument("1.2.3") as any;
    expect(doc.info.version).toBe("1.2.3");
    const opIds = Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((op: any) => op.operationId));
    for (const id of ["createLink", "listLinks", "getLink", "deleteLink", "requestShortlinksDomain", "checkDomainAvailability", "getDomainProvisioning", "reconcileDomainProvisioning", "deleteDomain", "getHealth", "getReady", "getVersion"]) {
      expect(opIds).toContain(id);
    }
  });
});

describe("combined management and public redirect planes", () => {
  function publicApp() {
    const calls: Array<{ host: string; slug: string; method?: string }> = [];
    const link = {
      id: "lnk_opaque_1",
      domain_id: "dom_opaque_1",
      hostname: "go.example.com",
      slug: "friendly-link",
      destination_url: "https://example.com/landing",
      title: null,
      active: true,
      expires_at: null,
      metadata: {},
      machine_id: null,
      synced_at: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };
    const store = {
      totalStats: async () => ({ domains: 1, links: 1, clicks: 0 }),
      resolve: async (host: string, slug: string) => {
        calls.push({ host, slug });
        return host === link.hostname && slug === link.slug ? link : null;
      },
      recordClick: async (_link: unknown, _input: unknown) => {
        calls.push({ host: link.hostname, slug: link.slug, method: "record" });
      },
    };
    const app = createServeApp({
      client: fakeClient(),
      store: store as unknown as PgShortlinksStore,
      version: "test",
      backend: "postgresql",
      signingSecret: "unit-test-signing-secret",
      keyStatus: async () => "active" as const,
      linkRouterSecret: EDGE_AUTH,
    });
    return { app, calls };
  }

  test("redirects a public friendly link without API credentials using the original edge host", async () => {
    const { app, calls } = publicApp();
    const res = await app.request("https://api.hasna.com/friendly-link", {
      headers: {
        host: "api.hasna.com",
        "x-forwarded-host": "api.hasna.com",
        "x-hasna-public-host": "go.example.com",
        "x-hasna-public-proto": "https",
        [LINK_ROUTER_AUTH_HEADER]: EDGE_AUTH,
      },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/landing");
    expect(calls[0]).toEqual({ host: "go.example.com", slug: "friendly-link" });
    expect(calls.some((call) => call.method === "record")).toBe(true);
  });

  test("HEAD redirects without recording a click while /v1 stays authenticated", async () => {
    const { app, calls } = publicApp();
    const head = await app.request("https://api.hasna.com/friendly-link", {
      method: "HEAD",
      headers: { "x-hasna-public-host": "go.example.com", [LINK_ROUTER_AUTH_HEADER]: EDGE_AUTH },
    });
    expect(head.status).toBe(302);
    expect(calls.some((call) => call.method === "record")).toBe(false);

    const api = await app.request("/v1/links", {
      headers: {
        "x-hasna-public-host": "go.example.com",
        "x-hasna-public-proto": "https",
      },
    });
    expect(api.status).toBe(401);
  });


  test("ignores spoofed public-host headers without edge authentication", async () => {
    const { app, calls } = publicApp();
    const res = await app.request("https://api.hasna.com/friendly-link", {
      headers: { "x-hasna-public-host": "go.example.com" },
    });
    expect(res.status).toBe(404);
    expect(calls[0]).toEqual({ host: "api.hasna.com", slug: "friendly-link" });
  });

  test("keeps unknown /v1 paths inside the authenticated namespace", async () => {
    const { app, calls } = publicApp();
    expect((await app.request("/v1")).status).toBe(401);
    expect((await app.request("/v1/not-a-route")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test("refuses the attachments prefix even if it reaches this origin", async () => {
    const { app, calls } = publicApp();
    const res = await app.request("https://api.hasna.com/a/token", {
      headers: { "x-hasna-public-host": "has.na", [LINK_ROUTER_AUTH_HEADER]: EDGE_AUTH },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Reserved path prefix." });
    expect(calls).toHaveLength(0);
  });
});

import { mintApiKey } from "@hasna/contracts/auth";
import type { DomainProvisioningJob } from "@hasna/domains/sdk";
import type { Domain } from "../types.js";
import type { DomainsProvisioningClient } from "../domains-provisioning.js";

const DOMAIN_TEST_SECRET = "unit-test-signing-secret";

function domainToken(scopes: string[]): string {
  return mintApiKey({ app: "shortlinks", scopes, signingSecret: DOMAIN_TEST_SECRET, ttlSeconds: 3600 }).token;
}

function domainJob(status: DomainProvisioningJob["status"] = "requested"): DomainProvisioningJob {
  return {
    id: "job-proof",
    domain_id: "portfolio-proof",
    name: "proof.example",
    idempotency_key: "shortlinks-domain:proof.example",
    request_hash: "hash",
    status,
    max_price_usd: 5,
    years: 1,
    auto_renew: false,
    acquisition_mode: "purchase",
    registrar: "route53",
    dns_provider: "cloudflare",
    target: "shortlinks",
    worker_name: "hasna-link-router",
    origin_hostname: null,
    origin_tls_mode: null,
    provider_state: { cloudflare_zone_id: "not-for-shortlinks-clients" },
    result: null,
    attempts: 0,
    error: null,
    lease_until: null,
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  };
}

function projectedDomain(status: "pending" | "active" = "pending"): Domain {
  return {
    id: "dom-proof",
    hostname: "proof.example",
    provider: "domains-api",
    default_domain: false,
    origin_url: null,
    notes: null,
    metadata: {
      provisioning: {
        mode: "domains-api",
        domains_job_id: "job-proof",
        domains_status: status === "active" ? "ready" : "requested",
        requested_default: true,
        status,
      },
    },
    machine_id: null,
    synced_at: null,
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  };
}

function makeDomainManagementApp(options: {
  domains: DomainsProvisioningClient;
  initial?: Domain | null;
}) {
  let current = options.initial ?? null;
  const writes: any[] = [];
  const deletes: string[] = [];
  const store = {
    totalStats: async () => ({ domains: current ? 1 : 0, links: 0, clicks: 0 }),
    listDomains: async () => current ? [current] : [],
    getDomain: async () => current,
    addDomain: async (input: any) => {
      writes.push(input);
      current = {
        ...(current ?? projectedDomain()),
        hostname: input.hostname,
        provider: input.provider ?? "managed",
        default_domain: Boolean(input.defaultDomain),
        notes: input.notes ?? null,
        metadata: input.metadata ?? {},
      };
      return current;
    },
    deleteDomain: async (hostname: string) => {
      deletes.push(hostname);
      const prior = current;
      current = null;
      if (!prior) throw new Error("Domain not found.");
      return prior;
    },
  };
  const app = createServeApp({
    client: fakeClient(),
    store: store as unknown as PgShortlinksStore,
    version: "test",
    backend: "postgresql",
    signingSecret: DOMAIN_TEST_SECRET,
    keyStatus: async () => "active" as const,
    domains: options.domains,
  });
  return { app, writes, deletes, current: () => current };
}

describe("Shortlinks /v1 Domains API integration", () => {
  test("forwards only business intent and rejects provider-field spoofing", async () => {
    const requests: Array<{ body: unknown; init?: RequestInit }> = [];
    const domains: DomainsProvisioningClient = {
      requestDomainProvisioning: async (body, init) => {
        requests.push({ body, init });
        return domainJob("requested");
      },
      getDomainProvisioning: async () => domainJob(),
      checkDomainAvailability: async ({ name }) => ({ name, available: true, price_usd: 3, currency: "USD" }),
    };
    const { app, writes } = makeDomainManagementApp({ domains });
    const token = domainToken(["shortlinks:write"]);

    const spoofed = await app.request("/v1/domains", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": token, "idempotency-key": "shortlinks-domain:proof.example" },
      body: JSON.stringify({
        hostname: "proof.example",
        max_price_usd: 5,
        auto_renew: false,
        cloudflare_zone_id: "spoof",
        registrar: "route53",
        dns_provider: "cloudflare",
        account_id: "also-spoofed",
      }),
    });
    expect(spoofed.status).toBe(400);
    expect(requests).toHaveLength(0);
    expect(writes).toHaveLength(0);

    const accepted = await app.request("/v1/domains", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": token, "idempotency-key": "shortlinks-domain:proof.example" },
      body: JSON.stringify({ hostname: "proof.example", max_price_usd: 5, years: 1, auto_renew: false, default: true }),
    });
    expect(accepted.status).toBe(202);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toEqual({
      name: "proof.example",
      max_price_usd: 5,
      years: 1,
      auto_renew: false,
      target: "shortlinks",
    });
    expect(new Headers(requests[0]!.init?.headers).get("idempotency-key")).toBe("shortlinks-domain:proof.example");
    const response = await accepted.json() as any;
    expect(response.domain.default_domain).toBe(false);
    expect(response.provisioning).not.toHaveProperty("provider_state");
    expect(JSON.stringify(response)).not.toContain("not-for-shortlinks-clients");
  });

  test("read-scoped status is side-effect free and write-scoped reconcile activates ready jobs", async () => {
    const domains: DomainsProvisioningClient = {
      requestDomainProvisioning: async () => domainJob(),
      getDomainProvisioning: async () => domainJob("ready"),
      checkDomainAvailability: async ({ name }) => ({ name, available: true }),
    };
    const { app, writes, current } = makeDomainManagementApp({ domains, initial: projectedDomain("pending") });

    const read = await app.request("/v1/domains/proof.example/provisioning", {
      headers: { "x-api-key": domainToken(["shortlinks:read"]) },
    });
    expect(read.status).toBe(200);
    expect(writes).toHaveLength(0);
    expect((await read.json() as any).status).toBe("ready");

    const reconcile = await app.request("/v1/domains/proof.example/reconcile", {
      method: "POST",
      headers: { "x-api-key": domainToken(["shortlinks:write"]) },
    });
    expect(reconcile.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(current()?.default_domain).toBe(true);
    expect((current()?.metadata.provisioning as any).status).toBe("active");
  });

  test("does not flatten Domains auth or outage failures into client 400s", async () => {
    const domains: DomainsProvisioningClient = {
      requestDomainProvisioning: async () => { throw Object.assign(new Error("upstream"), { status: 403 }); },
      getDomainProvisioning: async () => { throw Object.assign(new Error("upstream"), { status: 503 }); },
      checkDomainAvailability: async () => { throw Object.assign(new Error("upstream"), { status: 503 }); },
    };
    const { app } = makeDomainManagementApp({ domains, initial: projectedDomain("pending") });
    const writeToken = domainToken(["shortlinks:write"]);
    const readToken = domainToken(["shortlinks:read"]);

    const purchase = await app.request("/v1/domains", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": writeToken, "idempotency-key": "shortlinks-domain:proof.example" },
      body: JSON.stringify({ hostname: "proof.example", max_price_usd: 5, auto_renew: false }),
    });
    expect(purchase.status).toBe(503);

    const availability = await app.request("/v1/domains/availability", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": readToken },
      body: JSON.stringify({ hostname: "proof.example" }),
    });
    expect(availability.status).toBe(502);
  });

  test("refuses unsafe local deletion of managed domains", async () => {
    const domains: DomainsProvisioningClient = {
      requestDomainProvisioning: async () => domainJob(),
      getDomainProvisioning: async () => domainJob(),
      checkDomainAvailability: async ({ name }) => ({ name, available: true }),
    };
    const { app, deletes } = makeDomainManagementApp({ domains, initial: projectedDomain("active") });
    const response = await app.request("/v1/domains/proof.example", {
      method: "DELETE",
      headers: { "x-api-key": domainToken(["shortlinks:write"]) },
    });
    expect(response.status).toBe(409);
    expect(deletes).toEqual([]);
  });
});
