import { describe, expect, test } from "bun:test";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { DomainsRepo, HttpError } from "./repo.js";

type Call = { method: "get" | "many" | "query"; sql: string; params: readonly unknown[] };

class ScriptedDb {
  readonly calls: Call[] = [];

  constructor(
    private readonly gets: unknown[] = [],
    private readonly manys: unknown[][] = [],
    private readonly queries: Array<{ rowCount: number }> = [],
  ) {}

  async get<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    this.calls.push({ method: "get", sql, params });
    const value = this.gets.shift();
    if (value instanceof Error) throw value;
    return (value ?? null) as T | null;
  }

  async many<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ method: "many", sql, params });
    return (this.manys.shift() ?? []) as T[];
  }

  async query(sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    this.calls.push({ method: "query", sql, params });
    return { rows: [], rowCount: this.queries.shift()?.rowCount ?? 0 };
  }
}

function makeRepo(options: {
  gets?: unknown[];
  manys?: unknown[][];
  queries?: Array<{ rowCount: number }>;
} = {}): { repo: DomainsRepo; db: ScriptedDb } {
  const db = new ScriptedDb(options.gets, options.manys, options.queries);
  return { repo: new DomainsRepo(db as unknown as TypedQueryClient), db };
}

const NOW = "2026-07-29T12:00:00.000Z";

function domainRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "domain-1", name: "example.com", registrar: "route53", status: "active",
    registered_at: null, expires_at: null, auto_renew: true, is_premium: false,
    premium_price: null, standard_price: null, purchase_price: null, purchase_date: null,
    nameservers: '["ns1.example.com"]', whois: '{"registrant":"Example"}',
    ssl_expires_at: null, ssl_issuer: null, notes: null, metadata: '{"source":"test"}',
    created_at: NOW, updated_at: NOW, ...overrides,
  };
}

function dnsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "dns-1", domain_id: "domain-1", type: "A", name: "@", value: "192.0.2.1",
    ttl: 3600, priority: null, created_at: NOW, ...overrides,
  };
}

function ownerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "owner-1", domain_id: "domain-1", contact_id: null, owner_name: "Example Owner",
    owner_email: null, owner_phone: null, owner_organization: null, source: "manual",
    verified: false, notes: null, created_at: NOW, updated_at: NOW, ...overrides,
  };
}

function historyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "history-1", domain_id: "domain-1", snapshot_type: "whois",
    raw_data: '{"status":"active"}', registrant_name: null, registrant_email: null,
    registrant_org: null, nameservers: '["ns1.example.com"]', registrar: "route53",
    status: "active", notes: null, created_at: NOW, ...overrides,
  };
}

function reputationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "reputation-1", domain_id: "domain-1", is_blacklisted: false,
    blacklist_sources: "[]", threat_score: 12, spam_score: 4, malware_detected: false,
    phishing_detected: false, reputation_sources: '["vendor"]', last_checked_at: NOW,
    notes: null, created_at: NOW, updated_at: NOW, ...overrides,
  };
}

describe("HttpError", () => {
  test("preserves the HTTP status, message, and error identity", () => {
    const error = new HttpError(403, "forbidden");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("HttpError");
    expect(error.status).toBe(403);
    expect(error.message).toBe("forbidden");
  });
});

describe("DomainsRepo domains", () => {
  test("creates a normalized domain and decodes JSON columns", async () => {
    const { repo, db } = makeRepo({ gets: [domainRow()] });

    const domain = await repo.createDomain({
      name: "  example.com  ", nameservers: ["ns1.example.com"],
      whois: { registrant: "Example" }, metadata: { source: "test" },
    });

    expect(domain.name).toBe("example.com");
    expect(domain.nameservers).toEqual(["ns1.example.com"]);
    expect(domain.whois).toEqual({ registrant: "Example" });
    expect(domain.metadata).toEqual({ source: "test" });
    expect(db.calls[0]?.params[1]).toBe("example.com");
  });

  test("rejects missing names, invalid statuses, and duplicate domains", async () => {
    const { repo: invalidRepo } = makeRepo();
    await expect(invalidRepo.createDomain({ name: " " })).rejects.toMatchObject({ status: 400 });
    await expect(invalidRepo.createDomain({ name: "x.test", status: "unknown" as "active" })).rejects.toMatchObject({ status: 400 });

    const { repo: duplicateRepo } = makeRepo({ gets: [new Error("duplicate key violates unique constraint")] });
    await expect(duplicateRepo.createDomain({ name: "x.test" })).rejects.toMatchObject({
      status: 409, message: "domain 'x.test' already exists",
    });
  });

  test("gets domains with safe JSON fallbacks and returns null for missing rows", async () => {
    const { repo } = makeRepo({ gets: [domainRow({ nameservers: "invalid", whois: null, metadata: "{" }), null] });

    const domain = await repo.getDomain("domain-1");
    expect(domain?.name).toBe("example.com");
    expect(domain?.nameservers).toEqual([]);
    expect(domain?.whois).toEqual({});
    expect(domain?.metadata).toEqual({});
    expect(await repo.getDomainByName("missing.test")).toBeNull();
  });

  test("filters domain lists and clamps pagination boundaries", async () => {
    const { repo, db } = makeRepo({ manys: [[domainRow()]] });

    const domains = await repo.listDomains({ search: "amp", status: "active", limit: 5000, offset: -2 });

    expect(domains.map((domain) => domain.name)).toEqual(["example.com"]);
    expect(db.calls[0]?.params).toEqual(["%amp%", "active", 1000, 0]);
    await expect(repo.listDomains({ status: "invalid" })).rejects.toMatchObject({ status: 400 });
  });

  test("updates changed fields while preserving missing and empty patches", async () => {
    const { repo } = makeRepo({ gets: [domainRow(), domainRow({ notes: "updated" }), domainRow(), null] });

    expect((await repo.updateDomain("domain-1", { notes: "updated" }))?.notes).toBe("updated");
    expect((await repo.updateDomain("domain-1", {}))?.name).toBe("example.com");
    expect(await repo.updateDomain("missing", { notes: "ignored" })).toBeNull();

    const { repo: invalidRepo } = makeRepo({ gets: [domainRow()] });
    await expect(invalidRepo.updateDomain("domain-1", { status: "invalid" as "active" })).rejects.toMatchObject({ status: 400 });
  });

  test("deletes, counts, and aggregates domain statistics", async () => {
    const { repo } = makeRepo({
      gets: [{ n: "7" }, { total: "7", active: "5", expired: "1", auto_renew_enabled: "4" }],
      queries: [{ rowCount: 1 }, { rowCount: 0 }],
    });

    expect(await repo.deleteDomain("domain-1")).toBe(true);
    expect(await repo.deleteDomain("missing")).toBe(false);
    expect(await repo.countDomains()).toBe(7);
    expect(await repo.getStats()).toEqual({
      total: 7, active: 5, expired: 1, transferring: 0, redemption: 0,
      auto_renew_enabled: 4, expiring_30_days: 0, ssl_expiring_30_days: 0,
    });
  });
});

describe("DomainsRepo related records", () => {
  test("maps DNS records and applies create defaults", async () => {
    const { repo, db } = makeRepo({ gets: [domainRow(), dnsRow()], manys: [[dnsRow()]] });

    expect((await repo.listDnsRecords("domain-1"))[0]?.value).toBe("192.0.2.1");
    expect((await repo.createDnsRecord("domain-1", { domain_id: "domain-1", type: "A", name: "@", value: "192.0.2.1" })).ttl).toBe(3600);
    expect(db.calls.at(-1)?.params.slice(5, 7)).toEqual([3600, null]);
  });

  test("guards invalid and orphaned DNS records", async () => {
    const { repo } = makeRepo({ gets: [null] });

    await expect(repo.createDnsRecord("domain-1", { domain_id: "domain-1", type: "CAA" as "A", name: "@", value: "0 issue ca.test" })).rejects.toMatchObject({ status: 400 });
    await expect(repo.createDnsRecord("domain-1", { domain_id: "domain-1", type: "A", name: "@", value: "192.0.2.1" })).rejects.toMatchObject({ status: 404 });
  });

  test("creates offers and rejects missing domains or invalid statuses", async () => {
    const offer = { id: "offer-1", domain_id: "domain-1", status: "pending", created_at: NOW };
    const { repo } = makeRepo({ gets: [domainRow(), offer] });
    expect((await repo.createOffer("domain-1", { domain_id: "domain-1" })).status).toBe("pending");

    const { repo: missingRepo } = makeRepo({ gets: [null] });
    await expect(missingRepo.createOffer("missing", { domain_id: "missing" })).rejects.toMatchObject({ status: 404 });
    const { repo: invalidRepo } = makeRepo({ gets: [domainRow()] });
    await expect(invalidRepo.createOffer("domain-1", { domain_id: "domain-1", status: "won" as "pending" })).rejects.toMatchObject({ status: 400 });
  });

  test("upserts email links and validates their type", async () => {
    const existing = { id: "email-link-1", thread_id: "thread-old" };
    const updated = { ...existing, domain_id: "domain-1", email_id: "email-1", thread_id: "thread-new", type: "offer" };
    const { repo } = makeRepo({ gets: [domainRow(), existing, updated] });

    expect((await repo.linkEmail("domain-1", { email_id: "email-1", thread_id: "thread-new", type: "offer" })).thread_id).toBe("thread-new");
    await expect(repo.linkEmail("domain-1", { email_id: "email-2", type: "other" as "offer" })).rejects.toMatchObject({ status: 400 });
  });

  test("creates supported alerts and rejects unsupported ones", async () => {
    const alert = { id: "alert-1", domain_id: "domain-1", type: "expiry", trigger_days_before: 30, created_at: NOW };
    const { repo } = makeRepo({ gets: [domainRow(), alert] });
    expect((await repo.createAlert("domain-1", { type: "expiry", trigger_days_before: 30 })).type).toBe("expiry");

    const { repo: invalidRepo } = makeRepo({ gets: [domainRow()] });
    await expect(invalidRepo.createAlert("domain-1", { type: "billing" as "expiry" })).rejects.toMatchObject({ status: 400 });
  });

  test("maps owners and guards invalid owner sources", async () => {
    const { repo } = makeRepo({ gets: [domainRow(), ownerRow({ verified: true })] });
    const owner = await repo.createOwner("domain-1", { owner_name: "Example Owner", verified: true });
    expect(owner).toMatchObject({ owner_name: "Example Owner", source: "manual", verified: true });

    const { repo: invalidRepo } = makeRepo({ gets: [domainRow()] });
    await expect(invalidRepo.createOwner("domain-1", { source: "crawler" as "manual" })).rejects.toMatchObject({ status: 400 });
  });

  test("maps history JSON, clamps limits, and validates snapshot types", async () => {
    const { repo, db } = makeRepo({ gets: [domainRow(), historyRow()], manys: [[historyRow()]] });
    const created = await repo.createHistory("domain-1", { snapshot_type: "whois", raw_data: { status: "active" } });
    expect(created.raw_data).toEqual({ status: "active" });
    expect(created.nameservers).toEqual(["ns1.example.com"]);

    expect((await repo.listHistory("domain-1", { type: "whois", limit: 5001 }))[0]?.snapshot_type).toBe("whois");
    expect(db.calls.at(-1)?.params).toEqual(["domain-1", "whois", 1000]);

    const { repo: invalidRepo } = makeRepo({ gets: [domainRow()] });
    await expect(invalidRepo.createHistory("domain-1", { snapshot_type: "billing" as "whois" })).rejects.toMatchObject({ status: 400 });
  });

  test("inserts and updates reputation while guarding missing domains", async () => {
    const { repo } = makeRepo({ gets: [domainRow(), null, reputationRow({ is_blacklisted: true })] });
    expect((await repo.upsertReputation("domain-1", { is_blacklisted: true })).is_blacklisted).toBe(true);

    const { repo: updateRepo } = makeRepo({ gets: [reputationRow(), domainRow(), reputationRow(), reputationRow({ threat_score: 80 })] });
    expect((await updateRepo.updateReputation("reputation-1", { threat_score: 80 }))?.threat_score).toBe(80);

    const { repo: missingRepo } = makeRepo({ gets: [null] });
    await expect(missingRepo.upsertReputation("missing", {})).rejects.toMatchObject({ status: 404 });
  });

  test("filters reputation lists and parses aggregate history counts", async () => {
    const { repo, db } = makeRepo({ manys: [
      [reputationRow({ is_blacklisted: true })],
      [reputationRow({ threat_score: 75 })],
      [{ domain_id: "domain-1", domain_name: "example.com", latest_snapshot_type: "whois", latest_snapshot_at: NOW, snapshot_count: "3" }],
    ] });

    expect((await repo.listReputation({ blacklisted: true }))[0]?.is_blacklisted).toBe(true);
    expect((await repo.listReputation({ threshold: 75 }))[0]?.threat_score).toBe(75);
    expect(db.calls[1]?.params).toEqual([75]);
    expect(await repo.listHistoryChanges()).toEqual([
      { domain_id: "domain-1", domain_name: "example.com", latest_snapshot_type: "whois", latest_snapshot_at: NOW, snapshot_count: 3 },
    ]);
  });
});
