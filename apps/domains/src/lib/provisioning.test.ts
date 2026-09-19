import { describe, expect, test } from "bun:test";
import {
  DomainProvisioningService,
  type DomainProvisioningJob,
  type DomainDnsReconciliation,
  type DomainProvisioningProviders,
  type DomainProvisioningRequest,
  type DomainProvisioningStore,
  type RegisteredDomainDetail,
} from "./provisioning.js";

class MemoryStore implements DomainProvisioningStore {
  jobs = new Map<string, DomainProvisioningJob>();
  dns = new Map<string, DomainDnsReconciliation>();
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

  async getByName(name: string): Promise<DomainProvisioningJob | null> {
    const job = [...this.jobs.values()].find((candidate) => candidate.name === name);
    return job ? structuredClone(job) : null;
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

  async reserveAdoption(
    request: DomainProvisioningRequest,
    requestHash: string,
    _detail: RegisteredDomainDetail,
  ): Promise<DomainProvisioningJob> {
    const existing = [...this.jobs.values()].find((job) =>
      job.idempotency_key === request.idempotency_key || job.name === request.name
    );
    if (existing) {
      if (existing.request_hash !== requestHash) throw new Error("different provisioning intent");
      return structuredClone(existing);
    }
    const now = new Date().toISOString();
    const job: DomainProvisioningJob = {
      ...request, id: `job-${this.jobs.size + 1}`, domain_id: `dom-${this.jobs.size + 1}`,
      request_hash: requestHash, status: "registered", provider_state: { last_provider_status: "externally_verified_owned" },
      attempts: 0, error: null, lease_token: null, lease_until: null, created_at: now, updated_at: now,
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  async reserveDnsReconciliation(input: Parameters<DomainProvisioningStore["reserveDnsReconciliation"]>[0]) {
    const existing = [...this.dns.values()].find((row) => row.idempotency_key === input.idempotencyKey);
    if (existing) {
      if (existing.request_hash !== input.requestHash) throw new Error("conflicting DNS reconciliation request");
      return structuredClone(existing);
    }
    const now = new Date().toISOString();
    const row: DomainDnsReconciliation = {
      id: `dns-${this.dns.size + 1}`, provisioning_job_id: input.job.id,
      domain_name: input.job.name, idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash, status: "requested", records: structuredClone(input.records),
      result: null, error: null, lease_token: null, lease_until: null,
      created_at: now, updated_at: now,
    };
    this.dns.set(row.id, row);
    return structuredClone(row);
  }

  async claimDnsReconciliation(id: string, leaseToken: string, leaseUntil: string) {
    const row = this.dns.get(id);
    if (!row || row.status === "ready" || row.lease_token) return null;
    row.lease_token = leaseToken; row.lease_until = leaseUntil;
    return structuredClone(row);
  }

  async updateDnsReconciliation(
    id: string,
    patch: Partial<DomainDnsReconciliation>,
    leaseToken: string,
  ) {
    const row = this.dns.get(id);
    if (!row || row.lease_token !== leaseToken) return null;
    Object.assign(row, structuredClone(patch), { updated_at: new Date().toISOString() });
    return structuredClone(row);
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
    origin_hostname: null,
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
    configureWebsiteOrigin: async ({ hostname, originHostname }) => [
      { type: "CNAME", name: hostname, value: originHostname, proxied: true, ttl: 1 },
      { type: "CNAME", name: `www.${hostname}`, value: originHostname, proxied: true, ttl: 1 },
    ],
    websiteOriginReady: async () => true,
    reconcileDnsRecords: async ({ records }) => records,
    dnsRecordsReady: async () => true,
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

  test("rejects zero or negative registrar prices before any purchase", async () => {
    for (const registrationPrice of [0, -1]) {
      const store = new MemoryStore();
      let submitted = 0;
      const service = new DomainProvisioningService(store, providers({
        checkAvailability: async () => ({
          available: true,
          registration_price_usd: registrationPrice,
          currency: "USD",
        }),
        submitRegistration: async () => { submitted++; return { operationId: "never" }; },
      }));
      const requested = await service.request(request({
        idempotency_key: `proof-invalid-price-${registrationPrice}`,
      }));
      const advanced = await service.advance(requested.id);
      expect(advanced.status).toBe("failed");
      expect(advanced.error).toContain("no positive bounded purchase price");
      expect(submitted).toBe(0);
    }
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

  test("configures a generic website origin and exposes only provider-neutral ready evidence", async () => {
    const store = new MemoryStore();
    const configured: unknown[] = [];
    let workerBindings = 0;
    const service = new DomainProvisioningService(store, providers({
      bindWorkerDomain: async () => { workerBindings++; },
      configureWebsiteOrigin: async (input) => {
        configured.push(input);
        return [
          { type: "CNAME", name: input.hostname, value: input.originHostname, proxied: true, ttl: 1 },
          { type: "CNAME", name: `www.${input.hostname}`, value: input.originHostname, proxied: true, ttl: 1 },
        ];
      },
    }), { now: () => new Date("2026-09-19T10:00:00.000Z") });
    let job = await service.request(request({
      target: "website_origin",
      worker_name: null,
      origin_hostname: "News-Origin-123.us-east-1.elb.amazonaws.com.",
    }));
    expect(job.origin_hostname).toBe("news-origin-123.us-east-1.elb.amazonaws.com");
    expect((await service.getByName("PROOF.EXAMPLE"))?.id).toBe(job.id);
    for (let i = 0; i < 8; i++) job = await service.advance(job.id);
    expect(job.status).toBe("ready");
    expect(workerBindings).toBe(0);
    expect(configured).toEqual([{
      hostname: "proof.example",
      zoneId: "cf-zone",
      originHostname: "news-origin-123.us-east-1.elb.amazonaws.com",
    }]);
    const { publicProvisioningJob } = await import("./provisioning.js");
    const publicJob = publicProvisioningJob(job);
    expect(publicJob).not.toHaveProperty("lease_token");
    expect(publicJob.result).toEqual({
      zone_ref: expect.stringMatching(/^zone:[0-9a-f]{24}$/),
      nameservers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      web_records: [
        { type: "CNAME", name: "proof.example", value: "news-origin-123.us-east-1.elb.amazonaws.com", proxied: true, ttl: 1 },
        { type: "CNAME", name: "www.proof.example", value: "news-origin-123.us-east-1.elb.amazonaws.com", proxied: true, ttl: 1 },
      ],
      checked_at: "2026-09-19T10:00:00.000Z",
    });
  });

  test("the scheduled worker automatically progresses a website job to durable readiness", async () => {
    const store = new MemoryStore();
    let registrationSubmissions = 0;
    let websiteBindings = 0;
    const service = new DomainProvisioningService(store, providers({
      submitRegistration: async () => {
        registrationSubmissions++;
        return { operationId: "reg-op" };
      },
      configureWebsiteOrigin: async ({ hostname, originHostname }) => {
        websiteBindings++;
        return [
          { type: "CNAME", name: hostname, value: originHostname, proxied: true, ttl: 1 },
          { type: "CNAME", name: `www.${hostname}`, value: originHostname, proxied: true, ttl: 1 },
        ];
      },
    }), { intervalMs: 1 });
    const requested = await service.request(request({
      target: "website_origin",
      worker_name: null,
      origin_hostname: "scheduled-origin.us-east-1.elb.amazonaws.com",
    }));
    service.start();
    try {
      const deadline = Date.now() + 2_000;
      let current = await store.get(requested.id);
      while (current?.status !== "ready" && Date.now() < deadline) {
        await Bun.sleep(2);
        current = await store.get(requested.id);
      }
      expect(current?.status).toBe("ready");
      expect(registrationSubmissions).toBe(1);
      expect(websiteBindings).toBe(1);
      const { publicProvisioningJob } = await import("./provisioning.js");
      expect(current && publicProvisioningJob(current).result).toMatchObject({
        web_records: [
          { name: "proof.example", value: "scheduled-origin.us-east-1.elb.amazonaws.com" },
          { name: "www.proof.example", value: "scheduled-origin.us-east-1.elb.amazonaws.com" },
        ],
      });
      await Bun.sleep(5);
      expect(registrationSubmissions).toBe(1);
      expect(websiteBindings).toBe(1);
    } finally {
      service.stop();
    }
  });

  test("validates target-specific fields before reservation and binds origin changes into idempotency", async () => {
    const store = new MemoryStore();
    const service = new DomainProvisioningService(store, providers());
    for (const origin_hostname of ["https://origin.example", "127.0.0.1", "localhost", "origin.example", "x.elb.amazonaws.com"]) {
      await expect(service.request(request({ target: "website_origin", worker_name: null, origin_hostname }))).rejects.toThrow("AWS ALB");
    }
    await expect(service.request(request({ target: "website_origin", origin_hostname: "lb.us-east-1.elb.amazonaws.com" }))).rejects.toThrow("worker_name");
    await expect(service.request(request({ origin_hostname: "lb.us-east-1.elb.amazonaws.com" }))).rejects.toThrow("origin_hostname");
    const first = await service.request(request({
      target: "website_origin", worker_name: null,
      origin_hostname: "one.us-east-1.elb.amazonaws.com",
    }));
    expect(first.id).toBeTruthy();
    await expect(service.request(request({
      target: "website_origin", worker_name: null,
      origin_hostname: "two.us-east-1.elb.amazonaws.com",
    }))).rejects.toThrow("conflicting provisioning request");
  });

  test("durably reconciles only bounded SES-compatible DNS records with conflict-safe replay", async () => {
    const store = new MemoryStore();
    const applied: unknown[] = [];
    const service = new DomainProvisioningService(store, providers({
      reconcileDnsRecords: async (input) => { applied.push(input); return input.records; },
    }), { now: () => new Date("2026-09-19T11:00:00.000Z") });
    let job = await service.request(request());
    for (let i = 0; i < 8; i++) job = await service.advance(job.id);
    const records = [
      { type: "MX", name: "mail.proof.example", value: "feedback-smtp.us-east-1.amazonses.com.", ttl: 300, priority: 10 },
      { type: "TXT", name: "_amazonses.proof.example", value: "verification-token", ttl: 300 },
      { type: "CNAME", name: "abc._domainkey.proof.example", value: "abc.dkim.amazonses.com.", ttl: 300 },
    ];
    const first = await service.reconcileDns("PROOF.EXAMPLE", {
      idempotency_key: "ses-dns-proof-001", records,
    });
    expect(first.status).toBe("ready");
    expect(first.result?.checked_at).toBe("2026-09-19T11:00:00.000Z");
    expect(first.records.map((record) => record.type)).toEqual(["CNAME", "MX", "TXT"]);
    expect(applied).toHaveLength(1);
    const replay = await service.reconcileDns("proof.example", {
      idempotency_key: "ses-dns-proof-001", records: [...records].reverse(),
    });
    expect(replay.id).toBe(first.id);
    expect(applied).toHaveLength(1);
    await expect(service.reconcileDns("proof.example", {
      idempotency_key: "ses-dns-proof-001",
      records: [{ type: "TXT", name: "proof.example", value: "different", ttl: 300 }],
    })).rejects.toThrow("conflicting DNS reconciliation request");
  });

  test("rejects unbounded, off-domain, and unsupported hosted DNS inputs before provider I/O", async () => {
    const store = new MemoryStore();
    let calls = 0;
    const service = new DomainProvisioningService(store, providers({
      reconcileDnsRecords: async ({ records }) => { calls++; return records; },
    }));
    let job = await service.request(request());
    for (let i = 0; i < 8; i++) job = await service.advance(job.id);
    for (const records of [
      [],
      [{ type: "A", name: "proof.example", value: "127.0.0.1", ttl: 300 }],
      [{ type: "TXT", name: "other.example", value: "x", ttl: 300 }],
      [{ type: "MX", name: "proof.example", value: "mx.example", ttl: 300 }],
      [{ type: "CNAME", name: "www.proof.example", value: "target.example", ttl: 1 }],
    ]) {
      await expect(service.reconcileDns("proof.example", { idempotency_key: "invalid-dns-001", records })).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  test("adopts an externally verified owned domain without registrar purchase and rejects conflicting intent", async () => {
    const store = new MemoryStore();
    let purchases = 0;
    let ownershipReads = 0;
    const service = new DomainProvisioningService(store, providers({
      submitRegistration: async () => { purchases++; return { operationId: "must-not-run" }; },
      getDomainDetail: async () => {
        ownershipReads++;
        return {
          nameservers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
          auto_renew: ownershipReads === 1 ? false : true,
        };
      },
    }));
    let job = await service.adopt({
      name: "Owned.Example", idempotency_key: "adopt-owned-001",
      target: "website_origin", origin_hostname: "owned-origin.us-east-1.elb.amazonaws.com",
    });
    expect(job.status).toBe("registered");
    expect(job.acquisition_mode).toBe("adopt");
    expect(job.max_price_usd).toBe(0);
    for (let i = 0; i < 6; i++) job = await service.advance(job.id);
    expect(job.status).toBe("ready");
    expect(purchases).toBe(0);
    const ownershipReadsBeforeReplay = ownershipReads;
    const replay = await service.adopt({
      name: "owned.example", idempotency_key: "adopt-owned-001",
      target: "website_origin", origin_hostname: "owned-origin.us-east-1.elb.amazonaws.com",
    });
    expect(replay.id).toBe(job.id);
    expect(ownershipReads).toBe(ownershipReadsBeforeReplay);
    await expect(service.adopt({
      name: "owned.example", idempotency_key: "adopt-owned-002",
      target: "website_origin", origin_hostname: "different.us-east-1.elb.amazonaws.com",
    })).rejects.toThrow("different provisioning intent");
  });
});
