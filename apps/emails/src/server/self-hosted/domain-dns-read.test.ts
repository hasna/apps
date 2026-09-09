import { expect, test } from "bun:test";
import { readDomainDnsRecords } from "./domain-dns-read.js";
import type { TenantScopedStore } from "./store.js";
const evidence = { registered: true, verified_for_sending: true, dns_tasks: [{ type: "CNAME" as const, name: "one._domainkey.example.test", value: "one.provider.test", purpose: "DKIM" as const, status: "verified" as const }] };
function fixture() {
  let domain: any = { id: "domain", domain: "example.test", provider: "provider" };
  const store = { getDomain: async (id: string) => id === "domain" ? domain : null, getResource: async (_: unknown, id: string) => id === "provider" ? { type: "ses" } : null } as unknown as TenantScopedStore;
  return { store, move: () => { domain = null; } };
}
test("reads bound provider DNS evidence without invoking mutations", async () => {
  const { store } = fixture();
  const result = await readDomainDnsRecords(store, "tenant", "domain", "provider", async (tenant, provider) => {
    expect([tenant, provider]).toEqual(["tenant", "provider"]);
    return { provider: "ses", send: async () => { throw Error("must not send"); }, readDomainConnection: async (domain, signal) => { expect(domain).toBe("example.test"); expect(signal.aborted).toBe(false); return evidence; } };
  });
  expect(result.source).toBe("live_provider"); expect(result.records).toHaveLength(2); expect(result.records[0]).toMatchObject(evidence.dns_tasks[0]);
});
test("missing/cross-tenant domain and mismatched selectors never call the provider", async () => {
  const { store } = fixture(); let calls = 0;
  const resolve = async () => { calls++; return null; };
  await expect(readDomainDnsRecords(store, "tenant", "other", undefined, resolve)).rejects.toMatchObject({ status: 404 });
  await expect(readDomainDnsRecords(store, "tenant", "domain", "other", resolve)).rejects.toMatchObject({ status: 409 });
  expect(calls).toBe(0);
});
test("bounds hung reads, redacts errors and rechecks ownership before returning records", async () => {
  const fixtureA = fixture();
  await expect(readDomainDnsRecords(fixtureA.store, "tenant", "domain", undefined, async () => ({ provider: "ses", send: async () => "never", readDomainConnection: async () => { throw Error("private-provider-detail"); } }))).rejects.not.toThrow("private-provider-detail");
  await expect(readDomainDnsRecords(fixtureA.store, "tenant", "domain", undefined, async () => ({ provider: "ses", send: async () => "never", readDomainConnection: () => new Promise(() => {}) }), undefined, 5)).rejects.toMatchObject({ status: 502 });
  await expect(readDomainDnsRecords(fixtureA.store, "tenant", "domain", undefined, async () => ({ provider: "ses", send: async () => "never", readDomainConnection: async () => { fixtureA.move(); return evidence; } }))).rejects.toMatchObject({ status: 409 });
});
