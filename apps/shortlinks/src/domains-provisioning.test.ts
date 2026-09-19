import { describe, expect, test } from "bun:test";
import type { DomainProvisioningJob } from "@hasna/domains/sdk";
import {
  createDomainsProvisioningClient,
  domainProvisioningMetadata,
  projectDomainProvisioning,
  readShortlinksDomainProvisioning,
  reconcilePendingShortlinksDomains,
  reconcileShortlinksDomain,
  requestShortlinksDomain,
  type DomainsProvisioningClient,
} from "./domains-provisioning.js";
import type { Domain } from "./types.js";

function job(overrides: Partial<DomainProvisioningJob> = {}): DomainProvisioningJob {
  return {
    id: "job-1",
    domain_id: "domain-1",
    name: "proof.example",
    idempotency_key: "shortlinks-domain:proof.example",
    request_hash: "hash",
    status: "requested",
    max_price_usd: 5,
    years: 1,
    auto_renew: false,
    registrar: "route53",
    dns_provider: "cloudflare",
    target: "shortlinks",
    worker_name: "hasna-link-router",
    provider_state: {},
    attempts: 0,
    error: null,
    lease_until: null,
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
    ...overrides,
  };
}

function domain(status: "pending" | "active" | "failed" = "pending", id = "job-1"): Domain {
  return {
    id: `dom-${id}`,
    hostname: `${id}.example`,
    provider: "domains-api",
    default_domain: false,
    origin_url: null,
    notes: null,
    metadata: {
      provisioning: {
        mode: "domains-api",
        domains_job_id: id,
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

describe("Shortlinks -> hosted Domains API boundary", () => {
  test("fails closed without the Domains service credential", () => {
    expect(() => createDomainsProvisioningClient({})).toThrow(/HASNA_DOMAINS_API_KEY is required/);
  });

  test("defaults to the canonical authority and sends only business intent plus target profile", async () => {
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return Response.json(job(), { status: 202 });
    }) as typeof fetch;
    const client = createDomainsProvisioningClient({
      HASNA_DOMAINS_API_KEY: "test-domains-service-key",
    }, fetchImpl);

    await requestShortlinksDomain(client, {
      hostname: "proof.example",
      maxPriceUsd: 5,
      years: 1,
      autoRenew: false,
      idempotencyKey: "shortlinks-domain:proof.example",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.hasna.com/domains/v1/provisioning");
    expect(calls[0]!.headers.get("x-api-key")).toBe("test-domains-service-key");
    expect(calls[0]!.headers.get("idempotency-key")).toBe("shortlinks-domain:proof.example");
    expect(calls[0]!.body).toEqual({
      name: "proof.example",
      max_price_usd: 5,
      years: 1,
      auto_renew: false,
      target: "shortlinks",
    });
    expect(JSON.stringify(calls[0]!.body)).not.toMatch(/route53|cloudflare|registrar|dns_provider|worker_name/);
  });

  test("supports an operator-owned Domains API for self-hosted deployments", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return Response.json({ name: "proof.example", available: true, price_usd: 3 });
    }) as typeof fetch;
    const client = createDomainsProvisioningClient({
      HASNA_DOMAINS_API_KEY: "self-hosted-key",
      HASNA_DOMAINS_API_URL: "https://domains.example.net/custom/v1",
    }, fetchImpl);
    await client.checkDomainAvailability({ name: "proof.example" });
    expect(calls).toEqual(["https://domains.example.net/custom/v1/availability"]);
  });

  test("projects only safe status fields and stores no provider implementation state", () => {
    const full = job({
      provider_state: { cloudflare_zone_id: "zone-sensitive", registration_operation_id: "op-sensitive" },
    });
    expect(projectDomainProvisioning(full)).toEqual({
      id: "job-1",
      name: "proof.example",
      status: "requested",
      error: null,
      created_at: "2026-09-19T00:00:00.000Z",
      updated_at: "2026-09-19T00:00:00.000Z",
    });
    expect(JSON.stringify(domainProvisioningMetadata(full, true))).not.toContain("zone-sensitive");
    expect(JSON.stringify(domainProvisioningMetadata(full, true))).not.toContain("op-sensitive");
  });

  test("read status is side-effect free while explicit reconcile activates ready domains", async () => {
    const original = domain("pending");
    let writes = 0;
    const store = {
      listDomains: async () => [original],
      addDomain: async (input: any) => {
        writes++;
        return {
          ...original,
          hostname: input.hostname,
          default_domain: Boolean(input.defaultDomain),
          metadata: input.metadata,
          updated_at: "2026-09-19T00:01:00.000Z",
        };
      },
    };
    const client: DomainsProvisioningClient = {
      requestDomainProvisioning: async () => job(),
      getDomainProvisioning: async () => job({ status: "ready" }),
      checkDomainAvailability: async () => ({ name: "proof.example", available: true, price_usd: 3 }),
    };

    expect((await readShortlinksDomainProvisioning(client, original)).status).toBe("ready");
    expect(writes).toBe(0);

    const reconciled = await reconcileShortlinksDomain(store, client, original);
    expect(writes).toBe(1);
    expect(reconciled.domain.default_domain).toBe(true);
    expect((reconciled.domain.metadata.provisioning as any).status).toBe("active");
  });

  test("background reconciliation isolates one Domains failure and continues", async () => {
    const first = domain("pending", "job-fails");
    const second = domain("pending", "job-ready");
    const writes: string[] = [];
    const store = {
      listDomains: async () => [first, second],
      addDomain: async (input: any) => {
        writes.push(input.hostname);
        return { ...second, hostname: input.hostname, metadata: input.metadata };
      },
    };
    const client: DomainsProvisioningClient = {
      requestDomainProvisioning: async () => job(),
      getDomainProvisioning: async (id) => {
        if (id === "job-fails") throw new Error("temporary Domains outage");
        return job({ id, status: "ready", name: second.hostname });
      },
      checkDomainAvailability: async () => ({ name: "proof.example", available: true }),
    };

    expect(await reconcilePendingShortlinksDomains(store, client)).toEqual({
      checked: 2,
      activated: 1,
      failed: 0,
      errors: 1,
    });
    expect(writes).toEqual([second.hostname]);
  });
});
