/**
 * Live PostgreSQL proof for the durable hosted Domains provisioning state.
 *
 * Normal package tests skip this file unless HASNA_DOMAINS_TEST_DATABASE_URL
 * points at an exclusive throwaway database. The dedicated workflow sets it
 * and the package's test:postgres script refuses to run without it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { createPgPool, createQueryClient, type PoolQueryClient } from "../generated/storage-kit/index.js";
import { provisioningRequestHash, type DomainProvisioningRequest } from "../lib/provisioning.js";
import { DomainsProvisioningRepo } from "./provisioning-repo.js";
import { DomainsRepo, HttpError } from "./repo.js";
import { buildMigrations, runMigrations } from "./migrations.js";

const dsn = process.env.HASNA_DOMAINS_TEST_DATABASE_URL?.trim();
const describeLive = dsn ? describe : describe.skip;
let client: PoolQueryClient;

function request(name: string, key: string): DomainProvisioningRequest {
  return {
    name,
    idempotency_key: key,
    max_price_usd: 80,
    years: 2,
    auto_renew: false,
    acquisition_mode: "purchase",
    registrar: "route53",
    dns_provider: "cloudflare",
    target: "shortlinks",
    worker_name: "hasna-link-router",
    origin_hostname: null,
    origin_tls_mode: null,
  };
}

function hash(value: DomainProvisioningRequest): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function legacyShortlinksPurchaseHash(value: DomainProvisioningRequest): string {
  return createHash("sha256").update(JSON.stringify({
    auto_renew: value.auto_renew,
    dns_provider: value.dns_provider,
    max_price_usd: value.max_price_usd,
    name: value.name,
    registrar: value.registrar,
    target: value.target,
    worker_name: value.worker_name,
    years: value.years,
  })).digest("hex");
}

describeLive("Domains provisioning against live PostgreSQL", () => {
  beforeAll(async () => {
    if (!dsn) throw new Error("HASNA_DOMAINS_TEST_DATABASE_URL must point at an exclusive throwaway PostgreSQL database");
    const url = new URL(dsn);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("live PostgreSQL proof requires a postgres URL");
    if (!/^(127\.0\.0\.1|localhost)$/.test(url.hostname)) throw new Error("live PostgreSQL proof refuses a non-loopback database");
    if (!/domains(_provisioning)?_ci/.test(url.pathname)) throw new Error("live PostgreSQL proof refuses a database not named for domains CI");

    const reset = new pg.Pool({ connectionString: dsn });
    try {
      await reset.query("DROP SCHEMA public CASCADE");
      await reset.query("CREATE SCHEMA public");
    } finally {
      await reset.end();
    }

    const env = {
      ...process.env,
      HASNA_DOMAINS_DATABASE_URL: dsn,
      HASNA_DOMAINS_DATABASE_URL_OWNER: dsn,
    };
    const first = await runMigrations({ env });
    expect(first.applied.length).toBe(buildMigrations().length);
    const second = await runMigrations({ env });
    expect(second.plan.every((item) => item.state === "already_applied")).toBe(true);

    client = createQueryClient(createPgPool({
      connectionString: dsn,
      applicationName: "domains-provisioning-live-test",
      max: 8,
    }));
  });

  afterAll(async () => {
    await client?.close();
  });

  test("proves migrations, idempotency races, leases and final portfolio projection", async () => {
    const expectedIds = buildMigrations().map((migration) => migration.id).sort();
    const ledger = await client.many<{ id: string }>("SELECT id FROM schema_migrations ORDER BY id");
    expect(ledger.map((row) => row.id)).toEqual(expectedIds);

    const suffix = randomUUID().slice(0, 8);
    const domain = `pg-${suffix}.example`;
    const idempotencyKey = `domains-pg-${suffix}`;
    const input = request(domain, idempotencyKey);
    const requestHash = hash(input);
    const left = new DomainsProvisioningRepo(client);
    const right = new DomainsProvisioningRepo(client);

    const [one, two] = await Promise.all([
      left.reserve(input, requestHash),
      right.reserve(input, requestHash),
    ]);
    expect(one.id).toBe(two.id);
    expect(one.domain_id).toBe(two.domain_id);
    expect(await client.one<{ n: string }>(
      "SELECT count(*)::text AS n FROM domain_provisioning_jobs WHERE idempotency_key = $1",
      [idempotencyKey],
    )).toEqual({ n: "1" });
    expect(await client.one<{ n: string }>(
      "SELECT count(*)::text AS n FROM domains WHERE name = $1",
      [domain],
    )).toEqual({ n: "1" });

    try {
      await left.reserve(input, `${requestHash}-conflict`);
      throw new Error("expected conflicting idempotency reservation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(409);
    }

    const legacyInput = request(`legacy-${suffix}.example`, `domains-legacy-${suffix}`);
    const legacyHash = legacyShortlinksPurchaseHash(legacyInput);
    const legacyJob = await left.reserve(legacyInput, legacyHash);
    const canonicalHash = provisioningRequestHash(legacyInput);
    expect(canonicalHash).not.toBe(legacyHash);
    const compatibleReplay = await right.reserve(legacyInput, canonicalHash);
    expect(compatibleReplay.id).toBe(legacyJob.id);
    expect(compatibleReplay.request_hash).toBe(legacyHash);
    const changedLegacyIntent = { ...legacyInput, years: legacyInput.years + 1 };
    await expect(left.reserve(
      changedLegacyIntent,
      provisioningRequestHash(changedLegacyIntent),
    )).rejects.toMatchObject({ status: 409 });

    const firstLease = await left.claim(one.id, "lease-one", new Date(Date.now() + 60_000).toISOString());
    expect(firstLease?.lease_token).toBe("lease-one");
    expect(await right.claim(one.id, "lease-two", new Date(Date.now() + 120_000).toISOString())).toBeNull();

    await client.execute(
      "UPDATE domain_provisioning_jobs SET lease_until = $2 WHERE id = $1",
      [one.id, new Date(Date.now() - 1_000).toISOString()],
    );
    const recovered = await right.claim(one.id, "lease-three", new Date(Date.now() + 120_000).toISOString());
    expect(recovered?.lease_token).toBe("lease-three");

    await right.markPortfolioReady(
      { ...recovered!, provider_state: { quoted_price_usd: 24 } },
      {
        registrar: "AWS Route 53",
        registered_at: "2026-09-19T00:00:00.000Z",
        expires_at: "2028-09-19T00:00:00.000Z",
        auto_renew: false,
        nameservers: ["a.ns.example", "b.ns.example"],
      },
    );

    const portfolio = new DomainsRepo(client);
    const projected = await portfolio.getDomain(one.domain_id);
    expect(projected).toMatchObject({
      id: one.domain_id,
      name: domain,
      status: "active",
      registrar: "AWS Route 53",
      auto_renew: false,
      purchase_price: 24,
      nameservers: ["a.ns.example", "b.ns.example"],
      metadata: { provisioning: { job_id: one.id, status: "ready", target: "shortlinks" } },
    });
    const listed = await portfolio.listDomains({ search: domain, limit: 10 });
    expect(listed.map((item) => item.id)).toEqual([one.domain_id]);

    const websiteInput: DomainProvisioningRequest = {
      ...request(`web-${suffix}.example`, `domains-web-${suffix}`),
      target: "website_origin",
      worker_name: null,
      origin_hostname: "origin.us-east-1.elb.amazonaws.com",
      origin_tls_mode: "full",
    };
    const website = await left.reserve(websiteInput, hash(websiteInput));
    expect(website).toMatchObject({
      target: "website_origin",
      worker_name: null,
      origin_hostname: "origin.us-east-1.elb.amazonaws.com",
      origin_tls_mode: "full",
    });
    const persisted = await client.one<{ origin_tls_mode: string }>(
      "SELECT origin_tls_mode FROM domain_provisioning_jobs WHERE id = $1",
      [website.id],
    );
    expect(persisted).toEqual({ origin_tls_mode: "full" });
    const conflicting = { ...websiteInput, origin_tls_mode: "strict" as const };
    await expect(left.reserve(conflicting, hash(conflicting))).rejects.toMatchObject({ status: 409 });
  });
});
