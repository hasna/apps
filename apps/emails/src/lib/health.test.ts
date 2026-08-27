import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { startV1Stub, type V1Stub } from "../test-support/v1-stub.js";
import { createProvider, deleteProvider } from "../db/providers.js";
import { createDomain, updateDnsStatus } from "../db/domains.js";
import { createAddress } from "../db/addresses.js";
import { checkProviderHealth, checkAllProviders, formatProviderHealth } from "./health.js";
import type { Provider } from "../types/index.js";
import type { ProviderAdapter } from "../providers/interface.js";

// Provider health metrics route to the /v1 domains + addresses repos. In the
// self-hosted model: domains carry a provider association (domain counts work),
// addresses do NOT (address counts are always 0), and the per-provider bounce
// rate is derived from the delivery events table which has no /v1 representation
// (always 0 here). Credential validation is skipped in the metric tests to avoid
// live provider network calls. The previous local-SQLite bulk/SQL-shape and
// event-bounce assertions validated removed behavior and are gone.

let stub: V1Stub;

beforeAll(async () => {
  stub = await startV1Stub();
});

afterAll(() => stub.stop());

beforeEach(async () => {
  await stub.reset();
  stub.applyEnv();
});

afterEach(() => {
  stub.clearEnv();
});

function baseProvider(): Provider {
  return { id: "p", name: "Test Resend", type: "resend", api_key: "re_test_123" } as unknown as Provider;
}

describe("formatProviderHealth", () => {
  it("formats healthy provider", () => {
    const output = formatProviderHealth({
      provider: baseProvider(),
      credentialsValid: true,
      credentialsChecked: true,
      domainCount: 2,
      verifiedDomains: 2,
      addressCount: 3,
      verifiedAddresses: 3,
      bounceRate: 1.5,
      status: "healthy",
    });
    expect(output).toContain("Test Resend");
    expect(output).toContain("resend");
    expect(output).toContain("valid");
    expect(output).toContain("2/2 verified");
    expect(output).toContain("3/3 verified");
    expect(output).toContain("1.5%");
  });

  it("formats error provider with credential failure", () => {
    const output = formatProviderHealth({
      provider: baseProvider(),
      credentialsValid: false,
      credentialsChecked: true,
      credentialError: "Invalid API key",
      domainCount: 0,
      verifiedDomains: 0,
      addressCount: 0,
      verifiedAddresses: 0,
      bounceRate: 0,
      status: "error",
    });
    expect(output).toContain("invalid");
    expect(output).toContain("Invalid API key");
  });

  it("formats warning provider with high bounce rate", () => {
    const output = formatProviderHealth({
      provider: baseProvider(),
      credentialsValid: true,
      credentialsChecked: true,
      domainCount: 1,
      verifiedDomains: 0,
      addressCount: 1,
      verifiedAddresses: 1,
      bounceRate: 8.5,
      status: "warning",
    });
    expect(output).toContain("8.5%");
    expect(output).toContain("0/1 verified");
  });
});

describe("checkProviderHealth", () => {
  it("reports credential error when the adapter cannot be constructed", async () => {
    const provider = createProvider({ name: "Broken", type: "sandbox" });
    const badProvider = { ...provider, type: "unknown" } as unknown as Provider;

    const health = await checkProviderHealth(badProvider);

    expect(health.credentialsValid).toBe(false);
    expect(health.credentialError).toBeDefined();
    expect(health.status).toBe("error");
  });

  it("counts provider domains and addresses from /v1", async () => {
    // Providers created via /v1 do not persist api keys (secrets are server-side),
    // so a sandbox provider is used — it is always locally configured.
    const provider = createProvider({ name: "Sandbox", type: "sandbox" });
    const d1 = createDomain(provider.id, "example.com");
    createDomain(provider.id, "test.com");
    updateDnsStatus(d1.id, "verified", "verified", "verified");
    createAddress({ provider_id: provider.id, email: "a@example.com" });
    createAddress({ provider_id: provider.id, email: "b@example.com" });

    const health = await checkProviderHealth(provider, { validateCredentials: false });

    expect(health.domainCount).toBe(2);
    expect(health.verifiedDomains).toBe(1);
    expect(health.addressCount).toBe(2);
    expect(health.verifiedAddresses).toBe(0);
    // Delivery events are server-side, so the client always reports a 0 bounce rate.
    expect(health.bounceRate).toBe(0);
    expect(health.status).toBe("healthy");
  });

  it("uses local credential configuration without live provider calls", async () => {
    const provider = createProvider({ name: "Sandbox", type: "sandbox" });
    const health = await checkProviderHealth(provider, { validateCredentials: false });
    expect(health.credentialsChecked).toBe(false);
    expect(health.credentialsValid).toBe(true);
    expect(health.status).toBe("healthy");
  });
});

describe("checkAllProviders", () => {
  it("returns empty array when no active providers", async () => {
    const provider = createProvider({ name: "Only", type: "sandbox" });
    deleteProvider(provider.id);
    const results = await checkAllProviders();
    expect(results).toEqual([]);
  });

  it("checks all active providers and batches their domain metrics", async () => {
    const first = createProvider({ name: "First", type: "sandbox" });
    const second = createProvider({ name: "Second", type: "sandbox" });
    const d1 = createDomain(first.id, "first.example.com");
    createDomain(second.id, "second.example.com");
    updateDnsStatus(d1.id, "verified", "verified", "verified");
    createAddress({ provider_id: first.id, email: "a@first.example.com" });

    const results = await checkAllProviders({ validateCredentials: false });
    const byName = new Map(results.map((result) => [result.provider.name, result]));

    expect(results.length).toBe(2);
    expect([...byName.keys()].sort()).toEqual(["First", "Second"]);
    expect(byName.get("First")).toMatchObject({
      domainCount: 1,
      verifiedDomains: 1,
      addressCount: 1,
      bounceRate: 0,
      status: "healthy",
    });
    expect(byName.get("Second")).toMatchObject({
      domainCount: 1,
      verifiedDomains: 0,
      addressCount: 0,
      bounceRate: 0,
      status: "healthy",
    });
  });
});

describe("provider health checks bound a hung provider API call (O15-04143)", () => {
  // `emails provider status` ran UNBOUNDED: one stalled SES/Resend credential
  // probe (adapter.listDomains() never settling) hung the whole Promise.all,
  // rc=124 at 25s and 45s with 0 bytes out. These regressions prove the
  // check now reports the hung provider as timed-out and still completes.
  const neverSettles: Promise<never> = new Promise(() => {});

  it("checkProviderHealth reports a timed-out provider instead of hanging", async () => {
    const provider = createProvider({ name: "Hung", type: "sandbox" });
    const hanging = { listDomains: () => neverSettles } as unknown as ProviderAdapter;

    const started = Date.now();
    const health = await checkProviderHealth(provider, {
      adapterTimeoutMs: 100,
      adapterFactory: () => hanging,
    });
    const elapsed = Date.now() - started;

    expect(health.credentialsChecked).toBe(true);
    expect(health.credentialsValid).toBe(false);
    expect(health.credentialError).toContain("timed out");
    expect(elapsed).toBeLessThan(5_000);
    expect(health.status).toBe("error");
  });

  it("checkAllProviders completes in bounded time with a hung provider among active ones", async () => {
    const provider = createProvider({ name: "HungAll", type: "sandbox" });
    const hanging = { listDomains: () => neverSettles } as unknown as ProviderAdapter;

    const started = Date.now();
    const results = await checkAllProviders({
      adapterTimeoutMs: 100,
      adapterFactory: () => hanging,
    });
    const elapsed = Date.now() - started;

    const hung = results.find((result) => result.provider.name === "HungAll");
    expect(hung).toBeDefined();
    expect(hung?.credentialsValid).toBe(false);
    expect(hung?.credentialError).toContain("timed out");
    expect(elapsed).toBeLessThan(5_000);
  });

  it("still reports valid credentials when the provider answers in time", async () => {
    const provider = createProvider({ name: "Quick", type: "sandbox" });
    const quick = { listDomains: async () => [] } as unknown as ProviderAdapter;

    const health = await checkProviderHealth(provider, { adapterFactory: () => quick });

    expect(health.credentialsChecked).toBe(true);
    expect(health.credentialsValid).toBe(true);
    expect(health.status).toBe("healthy");
  });
});
