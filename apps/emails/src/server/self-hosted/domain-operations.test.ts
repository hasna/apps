import { expect, it } from "bun:test";
import { runDomainOperation } from "./domain-operations.js";
import type { TenantScopedStore } from "./store.js";
import type { SelfHostedSender } from "./sender.js";
function fixture() {
  const row = { id: "domain-id", domain: "example.test", provider: "provider-id", status: "active", verified: true, provisioning_status: "ready" };
  const patches: unknown[] = [];
  const store = {
    getDomain: async (id: string) => id === row.id ? row : null,
    getDomainByName: async (name: string) => name === row.domain ? row : null,
    getResource: async (_spec: unknown, id: string) => id === "provider-id" ? { type: "ses", active: true } : null,
    updateDomain: async (_id: string, patch: object) => { patches.push(patch); return Object.assign(row, patch); },
    applyDomainProvisioning: async (_id: string, patch: object) => { patches.push(patch); return Object.assign(row, patch); },
  } as unknown as TenantScopedStore;
  const sender: SelfHostedSender = { provider: "ses", region: "us-east-1", send: async () => { throw new Error("no mail"); }, verifyDomain: async () => ({ dkim: "verified", spf: "verified", dmarc: "pending" }), checkInboundDomain: async () => ({ ready: true, reason: "receipt rule checked" }) };
  return { store, row, patches, sender, options: { resolveSender: async () => sender } };
}
it("disables outbound without altering verification or inbound readiness", async () => {
  const f = fixture();
  await runDomainOperation(f.store, "tenant", "domain-id", "disable-outbound");
  expect(f.row).toMatchObject({ status: "outbound_disabled", verified: true, provisioning_status: "ready" });
});
it("requires verified provider evidence before enabling outbound", async () => {
  const f = fixture();
  f.sender.verifyDomain = async () => ({ dkim: "pending", spf: "pending", dmarc: "pending" });
  await expect(runDomainOperation(f.store, "tenant", "domain-id", "enable-outbound", f.options)).rejects.toThrow("not verified");
  expect(f.patches).toEqual([]);
});
it("preserves domain state when the provider read fails", async () => {
  const f = fixture();
  f.sender.verifyDomain = async () => { throw new Error("provider offline"); };
  await expect(runDomainOperation(f.store, "tenant", "domain-id", "verify", f.options)).rejects.toThrow("provider offline");
  expect(f.patches).toEqual([]);
});
it("verifies the provider, published MX, and receipt route before marking inbound ready", async () => {
  const f = fixture();
  const options = { ...f.options, env: { EMAILS_INGEST_S3_BUCKET: "fixture-bucket", EMAILS_INGEST_QUEUE_URL: "fixture-queue" }, mx: async () => [{ exchange: "other-provider.test", priority: 10 }] };
  await expect(runDomainOperation(f.store, "tenant", "example.test", "enable-inbound", options)).rejects.toThrow("published MX");
  expect(f.patches).toEqual([]);
  options.mx = async () => [{ exchange: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 }];
  const result = await runDomainOperation(f.store, "tenant", "example.test", "enable-inbound", options);
  expect(result.inbound?.ready).toBe(true);
});
it("does not upgrade another tenant's unknown domain or an unbound provider", async () => {
  const f = fixture();
  await expect(runDomainOperation(f.store, "tenant", "other.test", "verify", f.options)).rejects.toThrow("not found");
  await expect(runDomainOperation(f.store, "tenant", "example.test", "verify")).rejects.toThrow("EMAILS_SENDER_BINDINGS");
  expect(f.patches).toEqual([]);
});
it("rejects mixed MX even when SES is present as backup or equal-priority routing", async () => {
  const f = fixture();
  for (const priority of [1, 10, 20]) {
    await expect(runDomainOperation(f.store, "tenant", "example.test", "enable-inbound", {
      ...f.options,
      env: { EMAILS_INGEST_S3_BUCKET: "fixture", EMAILS_INGEST_QUEUE_URL: "fixture" },
      mx: async () => [{ exchange: "aspmx.l.google.com", priority }, { exchange: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 }],
    })).rejects.toThrow("published MX");
  }
  expect(f.patches).toEqual([]);
});
it("uses authoritative sending readiness without inventing SPF or DMARC results", async () => {
  const f = fixture();
  f.sender.verifyDomain = async () => ({ verifiedForSending: true, dkim: "verified", spf: "pending", dmarc: "pending" });
  const result = await runDomainOperation(f.store, "tenant", "domain-id", "enable-outbound", f.options);
  expect(result.outbound_enabled).toBe(true);
  expect(result.dns).toMatchObject({ spf: "pending", dmarc: "pending" });
});
