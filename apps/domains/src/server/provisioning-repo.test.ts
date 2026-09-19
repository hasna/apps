import { describe, expect, test } from "bun:test";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { provisioningRequestHash, type DomainProvisioningRequest } from "../lib/provisioning.js";
import { DomainsProvisioningRepo } from "./provisioning-repo.js";
import { HttpError } from "./repo.js";

function request(): DomainProvisioningRequest {
  return {
    name: "wanted.example",
    idempotency_key: "shared-idempotency-key",
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
  };
}

function provisioningRow(input: DomainProvisioningRequest, id: string) {
  return {
    id,
    domain_id: `domain-${id}`,
    domain_name: input.name,
    idempotency_key: input.idempotency_key,
    request_hash: provisioningRequestHash(input),
    status: "requested",
    max_price_usd: input.max_price_usd,
    years: input.years,
    auto_renew: input.auto_renew,
    acquisition_mode: input.acquisition_mode,
    registrar: input.registrar,
    dns_provider: input.dns_provider,
    target: input.target,
    worker_name: input.worker_name,
    origin_hostname: input.origin_hostname,
    origin_tls_mode: input.origin_tls_mode,
    provider_state: "{}",
    attempts: 0,
    error: null,
    lease_token: null,
    lease_until: null,
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  };
}

const domainRow = {
  id: "domain-wanted",
  name: "wanted.example",
  registrar: "AWS Route 53",
  status: "researching",
  registered_at: null,
  expires_at: null,
  auto_renew: false,
  is_premium: false,
  premium_price: null,
  standard_price: null,
  purchase_price: null,
  purchase_date: null,
  nameservers: "[]",
  whois: "{}",
  ssl_expires_at: null,
  ssl_issuer: null,
  notes: null,
  metadata: "{}",
  created_at: "2026-09-19T00:00:00.000Z",
  updated_at: "2026-09-19T00:00:00.000Z",
  expiry_synced_at: null,
};

describe("DomainsProvisioningRepo idempotency race recovery", () => {
  test("never hides a concurrently consumed idempotency key behind a compatible domain row", async () => {
    const input = request();
    const keyOwnerInput = { ...input, name: "other.example" };
    const keyOwner = provisioningRow(keyOwnerInput, "key-owner");
    const domainOwner = provisioningRow({ ...input, idempotency_key: "other-key" }, "domain-owner");
    let keyReads = 0;
    let domainReads = 0;
    let insertAttempts = 0;
    const db = {
      get: async (sql: string) => {
        if (sql.includes("FROM domain_provisioning_jobs WHERE idempotency_key = $1")) {
          keyReads++;
          return keyReads === 1 ? null : keyOwner;
        }
        if (sql.includes("FROM domain_provisioning_jobs WHERE domain_name = $1")) {
          domainReads++;
          return domainReads === 1 ? null : domainOwner;
        }
        if (sql.includes("SELECT * FROM domains WHERE name = $1")) return domainRow;
        if (sql.includes("INSERT INTO domain_provisioning_jobs")) {
          insertAttempts++;
          throw new Error("duplicate key value violates unique constraint");
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    } as unknown as TypedQueryClient;

    const repo = new DomainsProvisioningRepo(db);
    try {
      await repo.reserve(input, provisioningRequestHash(input));
      throw new Error("expected crossed uniqueness claims to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(409);
      expect((error as Error).message).toContain("idempotency key already used");
    }
    expect(insertAttempts).toBe(1);
    expect(keyReads).toBe(2);
    expect(domainReads).toBe(1);
  });
});
