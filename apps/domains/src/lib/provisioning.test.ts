import { describe, expect, test } from "bun:test";
import {
  DomainProvisioningService,
  type DomainProvisioningJob,
  type DomainProvisioningProviders,
  type DomainProvisioningRequest,
  type DomainProvisioningStore,
  type RegisteredDomainDetail,
} from "./provisioning.js";

class MemoryStore implements DomainProvisioningStore {
  jobs = new Map<string, DomainProvisioningJob>();
  ready: Array<{ job: DomainProvisioningJob; detail: RegisteredDomainDetail }> = [];

  async reserve(request: DomainProvisioningRequest, requestHash: string): Promise<DomainProvisioningJob> {
    const existing = [...this.jobs.values()].find((job) => job.idempotency_key === request.idempotency_key || job.name === request.name);
    if (existing) {
      if (existing.request_hash !== requestHash) throw new Error("conflicting provisioning request");
      return structuredClone(existing);
    }
    const now = new Date().toISOString();
    const job: DomainProvisioningJob = {
      ...request,
      id: `job-${this.jobs.size + 1}`,
      domain_id: `dom-${this.jobs.size + 1}`,
      request_hash: requestHash,
      status: "requested",
      provider_state: {},
      attempts: 0,
      error: null,
      lease_token: null,
      lease_until: null,
      created_at: now,
      updated_at: now,
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  async get(id: string): Promise<DomainProvisioningJob | null> {
    return this.jobs.has(id) ? structuredClone(this.jobs.get(id)!) : null;
  }

  async listRunnable(limit: number): Promise<DomainProvisioningJob[]> {
    return [...this.jobs.values()]
      .filter((job) => !["ready", "manual_review", "failed"].includes(job.status) && !job.lease_token)
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  async claim(id: string, leaseToken: string, leaseUntil: string): Promise<DomainProvisioningJob | null> {
    const job = this.jobs.get(id);
    if (!job || job.lease_token || ["ready", "manual_review", "failed"].includes(job.status)) return null;
    job.lease_token = leaseToken;
    job.lease_until = leaseUntil;
    return structuredClone(job);
  }

  async update(id: string, patch: Partial<DomainProvisioningJob>, leaseToken?: string): Promise<DomainProvisioningJob | null> {
    const job = this.jobs.get(id);
    if (!job || (leaseToken !== undefined && job.lease_token !== leaseToken)) return null;
    Object.assign(job, structuredClone(patch), { updated_at: new Date().toISOString() });
    return structuredClone(job);
  }

  async markPortfolioReady(job: DomainProvisioningJob, detail: RegisteredDomainDetail): Promise<void> {
    this.ready.push({ job: structuredClone(job), detail: structuredClone(detail) });
  }
}

function request(overrides: Partial<DomainProvisioningRequest> = {}): Partial<DomainProvisioningRequest> {
  return {
    name: "Proof.Example",
    idempotency_key: "proof-request-001",
    max_price_usd: 5,
    years: 1,
    auto_renew: false,
    registrar: "route53",
    dns_provider: "cloudflare",
    target: "shortlinks",
    worker_name: "hasna-link-router",
    ...overrides,
  };
}

function providers(overrides: Partial<DomainProvisioningProviders> = {}): DomainProvisioningProviders {
  let hostedZoneReads = 0;
  return {
    checkAvailability: async () => ({ available: true, price_usd: 3, currency: "USD" }),
    submitRegistration: async () => ({ operationId: "reg-op" }),
    getOperationStatus: async (id) => ({ status: id === "reg-op" || id === "ns-op" ? "SUCCESSFUL" : "ERROR" }),
    getDomainDetail: async () => ({
      registered_at: "2026-09-19T00:00:00.000Z",
      expires_at: "2027-09-19T00:00:00.000Z",
      auto_renew: false,
      nameservers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      registrar: "AWS Route 53",
    }),
    ensureCloudflareZone: async () => ({ id: "cf-zone", status: "active", nameservers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"] }),
    updateNameservers: async () => ({ operationId: "ns-op" }),
    resolvePublicNameservers: async () => ["bob.ns.cloudflare.com.", "amy.ns.cloudflare.com."],
    bindWorkerDomain: async () => {},
    workerDomainReady: async () => true,
    listRoute53HostedZoneIds: async () => ++hostedZoneReads === 1 ? [] : ["r53-zone"],
    cleanupRoute53HostedZone: async () => true,
    ...overrides,
  };
}

describe("DomainProvisioningService", () => {
  test("runs the complete registrar -> Cloudflare -> Shortlinks flow without client provider logic", async () => {
    const store = new MemoryStore();
    let bound = 0;
    let cleaned = 0;
    const service = new DomainProvisioningService(store, providers({
      bindWorkerDomain: async (input) => {
        expect(input).toEqual({ hostname: "proof.example", zoneId: "cf-zone", workerName: "hasna-link-router" });
        bound++;
      },
      cleanupRoute53HostedZone: async (input) => {
        expect(input).toEqual({
          name: "proof.example",
          hostedZoneId: "r53-zone",
          registrarNameservers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
        });
        cleaned++;
        return true;
      },
    }));
    let job = await service.request(request());
    expect(job.name).toBe("proof.example");
    for (let i = 0; i < 8; i++) job = await service.advance(job.id);
    expect(job.status).toBe("ready");
    expect(job.provider_state.quoted_price_usd).toBe(3);
    expect(job.provider_state.registration_operation_id).toBe("reg-op");
    expect(job.provider_state.cloudflare_zone_id).toBe("cf-zone");
    expect(job.provider_state.worker_domain_bound).toBe(true);
    expect(job.provider_state.route53_zone_ids_before_registration).toEqual([]);
    expect(job.provider_state.route53_hosted_zone_id).toBe("r53-zone");
    expect(job.provider_state.route53_hosted_zone_cleaned).toBe(true);
    expect(bound).toBe(1);
    expect(cleaned).toBe(1);
    expect(store.ready).toHaveLength(1);
    expect(store.ready[0]!.job.id).toBe(job.id);
  });

  test("never cleans a pre-existing or ambiguously-created Route 53 zone", async () => {
    for (const zoneSnapshots of [
      [["preexisting"], ["preexisting"]],
      [[], ["new-a", "new-b"]],
    ]) {
      const store = new MemoryStore();
      let reads = 0;
      let cleanupCalls = 0;
      const service = new DomainProvisioningService(store, providers({
        listRoute53HostedZoneIds: async () => zoneSnapshots[Math.min(reads++, zoneSnapshots.length - 1)]!,
        cleanupRoute53HostedZone: async () => { cleanupCalls++; return true; },
      }));
      let job = await service.request(request({ idempotency_key: `proof-safe-cleanup-${reads}-${zoneSnapshots[0]!.length}` }));
      for (let i = 0; i < 8; i++) job = await service.advance(job.id);
      expect(job.status).toBe("ready");
      expect(job.provider_state.route53_hosted_zone_id).toBeUndefined();
      expect(cleanupCalls).toBe(0);
    }
  });

  test("enforces the caller ceiling against the total multi-year charge before any purchase", async () => {
    const store = new MemoryStore();
    let submitted = 0;
    const service = new DomainProvisioningService(store, providers({
      checkAvailability: async () => ({ available: true, price_usd: 3, currency: "USD" }),
      submitRegistration: async () => { submitted++; return { operationId: "never" }; },
    }));
    let job = await service.request(request({ max_price_usd: 5, years: 2 }));
    job = await service.advance(job.id);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("quoted total price exceeds max_price_usd (6 > 5)");
    expect(submitted).toBe(0);
  });

  test("rechecks availability and price immediately before registrar submission", async () => {
    const store = new MemoryStore();
    let checks = 0;
    let submitted = 0;
    const service = new DomainProvisioningService(store, providers({
      checkAvailability: async () => ({ available: true, price_usd: ++checks === 1 ? 3 : 7, currency: "USD" }),
      submitRegistration: async () => { submitted++; return { operationId: "never" }; },
    }));
    let job = await service.request(request({ max_price_usd: 5 }));
    job = await service.advance(job.id);
    expect(job.status).toBe("quoted");
    job = await service.advance(job.id);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("quoted total price exceeds max_price_usd (7 > 5)");
    expect(checks).toBe(2);
    expect(submitted).toBe(0);
  });

  test("an ambiguous registration submission never retries or double-buys", async () => {
    const store = new MemoryStore();
    let submitted = 0;
    const service = new DomainProvisioningService(store, providers({
      submitRegistration: async () => { submitted++; throw new Error("network timeout"); },
    }));
    let job = await service.request(request());
    job = await service.advance(job.id);
    expect(job.status).toBe("quoted");
    job = await service.advance(job.id);
    expect(job.status).toBe("manual_review");
    expect(job.error).toContain("ambiguous");
    expect(submitted).toBe(1);
    const again = await service.advance(job.id);
    expect(again.status).toBe("manual_review");
    expect(submitted).toBe(1);
  });

  test("keeps worker-bound jobs retryable until the portfolio projection is durable", async () => {
    const store = new MemoryStore();
    let projectionAttempts = 0;
    store.markPortfolioReady = async (job, detail) => {
      projectionAttempts++;
      if (projectionAttempts === 1) throw new Error("temporary portfolio write failure");
      store.ready.push({ job: structuredClone(job), detail: structuredClone(detail) });
    };
    const service = new DomainProvisioningService(store, providers());
    let job = await service.request(request());
    for (let i = 0; i < 7; i++) job = await service.advance(job.id);
    expect(job.status).toBe("worker_bound");
    job = await service.advance(job.id);
    expect(job.status).toBe("worker_bound");
    expect(job.error).toContain("temporary portfolio write failure");
    job = await service.advance(job.id);
    expect(job.status).toBe("ready");
    expect(projectionAttempts).toBe(2);
    expect(store.ready).toHaveLength(1);
  });

  test("rejects invalid worker scheduling options instead of starting a hot loop", () => {
    const store = new MemoryStore();
    expect(() => new DomainProvisioningService(store, providers(), { intervalMs: Number.NaN })).toThrow("intervalMs");
    expect(() => new DomainProvisioningService(store, providers(), { batchSize: 0 })).toThrow("batchSize");
    expect(() => new DomainProvisioningService(store, providers(), { leaseMs: -1 })).toThrow("leaseMs");
    expect(() => new DomainProvisioningService(store, providers(), { maxAttempts: 1.5 })).toThrow("maxAttempts");
  });

  test("idempotency keys are stable and explicit purchase choices are required", async () => {
    const store = new MemoryStore();
    const service = new DomainProvisioningService(store, providers());
    const first = await service.request(request());
    const second = await service.request(request({ name: "proof.example" }));
    expect(second.id).toBe(first.id);
    await expect(service.request(request({ auto_renew: undefined }))).rejects.toThrow("auto_renew");
    await expect(service.request(request({ idempotency_key: "short" }))).rejects.toThrow("idempotency_key");
    await expect(service.request(request({ registrar: "godaddy" as never }))).rejects.toThrow("route53");
  });
});
