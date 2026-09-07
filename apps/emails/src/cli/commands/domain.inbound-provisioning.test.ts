import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { baseSeed, cliFixture, domainName, providerId, setupReceipt, sourceId } from "./domain-setup.test-support.js";
let api: V1Stub, cli: ReturnType<typeof cliFixture>;
beforeAll(async () => { api = await startV1Stub({ openapi: true, resourceFilters: true }); });
afterAll(() => api.stop());
beforeEach(async () => { await api.reset(); await api.seed(baseSeed()); cli = cliFixture(api); });
afterEach(() => { expect(cli.unchanged()).toBe(true); cli.close(); });
test("domain add connects and configures inbound through account APIs, retaining separate verification", async () => {
  const result = cli.run(["domain", "add", domainName, "--provider", providerId]);
  expect(result.code, result.stderr).toBe(0); expect(result.data).toMatchObject({ ok: true, source_of_truth: "postgres", connection: { status: "verified" }, inbound: setupReceipt });
  expect(await api.list("domains")).toHaveLength(1); expect(await api.list("domain-connect-requests")).toHaveLength(1); expect(await api.list("ses-setup-requests")).toHaveLength(1);
});
test("missing source prevents registration; existing domain does not depend on local bucket config", async () => {
  await api.seed({ ...baseSeed(), sources: [] });
  const absent = cli.run(["domain", "add", domainName, "--provider", providerId]); expect(absent.code).toBe(1);
  expect(await api.list("domain-connect-requests")).toEqual([]); expect(await api.list("domains")).toEqual([]);
  await api.seed({ ...baseSeed(), domains: [{ id: "existing", domain: domainName, provider: providerId }] });
  const existing = cli.run(["domains", "add", domainName, "--provider", providerId]); expect(existing.code, existing.stderr).toBe(0); expect(await api.list("domains")).toHaveLength(1);
});
test("post-registration setup failure retains connection receipt and reports nonzero", async () => {
  await api.seed({ ...baseSeed(), "ses-setup-results": [{ domain: domainName, receipt: { ...setupReceipt, ok: false, verified: false, changes_may_have_applied: true } }] });
  const result = cli.run(["domain", "add", domainName, "--provider", providerId]); expect(result.code).toBe(1);
  expect(result.data).toMatchObject({ ok: false, connection: { domain_id: expect.any(String) }, inbound: { ok: false, changes_may_have_applied: true } });
  expect(await api.list("domains")).toHaveLength(1);
});
test("send-only deliberately skips source selection and inbound setup", async () => {
  await api.seed({ ...baseSeed(), sources: [] });
  const result = cli.run(["domain", "add", domainName, "--provider", providerId, "--send-only"]); expect(result.code, result.stderr).toBe(0);
  expect(result.data.inbound).toBeUndefined(); expect(await api.list("ses-setup-requests")).toEqual([]);
});
test("dry-run resolves shared source without creating a domain or invoking providers", async () => {
  const result = cli.run(["domain", "add", domainName, "--provider", providerId, "--dry-run"]); expect(result.code, result.stderr).toBe(0);
  expect(result.data).toMatchObject({ dry_run: true, source_of_truth: "postgres", inbound_chain: { source_id: sourceId, server_binding_checked: false } });
  expect(await api.list("domain-connect-requests")).toEqual([]); expect(await api.list("ses-setup-requests")).toEqual([]); expect(await api.list("domains")).toEqual([]);
});
test("source without provider metadata remains usable under the authoritative server binding", async () => {
  const seed = baseSeed(); seed.sources[0]!.provider_id = null as any; await api.seed(seed);
  const result = cli.run(["domain", "add", domainName, "--provider", providerId]); expect(result.code, result.stderr).toBe(0);
});
test("adopt uses API connection, alias and source-scoped sync without a local mail database", async () => {
  await api.seed({ ...baseSeed(), "sync-results": [{ operation: "sync-s3", receipt: { ok: true, sources: [{ source_id: sourceId, scanned: 2, ingested: 2, duplicate: 0, error: 0, notifications: 0, acknowledged: 0, next_cursor: null, complete: true, queue: null }] } }] });
  const result = cli.run(["domain", "adopt", domainName, "--provider", providerId, "--catch-all", "ops@example.test", "--sync"]);
  expect(result.code, result.stderr + result.stdout).toBe(0); expect(result.data).toMatchObject({ ok: true, inbound: { verified: true }, sync: { ok: true } });
  expect(await api.list("sync-requests")).toMatchObject([{ operation: "sync-s3", source_id: sourceId, bucket: "bound-inbound", provider_id: providerId }]);
  expect((await api.list("aliases")).some(row => row.target_address === "ops@example.test")).toBe(true);
});
test("readiness distinguishes registry observations from unknown live AWS state", async () => {
  await api.seed({ ...baseSeed(), domains: [{ id: "existing", domain: domainName, provider: providerId, verified: true }] });
  const result = cli.run(["domain", "readiness", domainName]); expect(result.code, result.stderr).toBe(0);
  expect(result.data).toMatchObject({ evidence: "account_registry", reports: [{ domain: domainName, receiving_ready: null, live_receipt_rules: "unknown" }] });
});
test("incompatible legacy selectors fail before registering a domain", async () => {
  for (const args of [["domain", "adopt", domainName, "--force-mx-switch"], ["domain", "add", domainName, "--domain-type", "local_only"], ["domain", "add", domainName, "--send-only", "--bucket", "bound-inbound"]]) expect(cli.run([...args, "--provider", providerId]).code).toBe(1);
  expect(await api.list("domain-connect-requests")).toEqual([]); expect(await api.list("ses-setup-requests")).toEqual([]);
});

test("sandbox send-only preserves API registry behavior without pretending provider contact", async () => {
  const seed = baseSeed(); seed.providers[0]!.type = "sandbox"; await api.seed({ ...seed, sources: [] });
  const result = cli.run(["domain", "add", domainName, "--provider", providerId, "--send-only"]);
  expect(result.code, result.stderr).toBe(0); expect(result.data).toMatchObject({ ok: true, registration_only: true, provider_contacted: false, receiving_configured: false });
  expect(await api.list("domain-connect-requests")).toEqual([]); expect(await api.list("domains")).toHaveLength(1);
});
