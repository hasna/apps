import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { installMcpToolContracts } from "../contracts.js";
import { registerInfrastructureTools } from "./infrastructure.js";
let stub: V1Stub;
const provider = "00000000-0000-4000-8000-000000000079";
const receipt = { dry_run: false, job: { id: "job", domain: "example.test", provider_id: provider, zone_id: "zone", status: "pending_verification", phase: "published", dns_published: true, verified_for_sending: false, requires_reconciliation: false, message: "DNS published; verification pending", plan: null } };
async function call(name: string, input: Record<string, unknown>) {
  const server = new McpServer({ name: "fixture", version: "1" });
  installMcpToolContracts(server);
  registerInfrastructureTools(server);
  return (server as any)._registeredTools[name].handler(input);
}
beforeAll(async () => { stub = await startV1Stub({ apiKey: crypto.randomUUID() }); });
beforeEach(async () => { await stub.reset(); stub.applyEnv(); await stub.seed({ providers: [{ id: provider, name: "fixture", type: "ses", active: true }], "dns-setup-results": ["setup", "setup-cloudflare"].map(operation => ({ operation, receipt })) }); });
afterEach(() => stub.clearEnv());
afterAll(() => stub.stop());
test("both MCP setup tools submit exact options through authenticated API", async () => {
  const owned = await call("setup_domain_for_email", { domain: "example.test", provider_id: provider, add_mx: true, force_mx_switch: true });
  expect(owned.isError).not.toBe(true); expect(JSON.parse(owned.content[0].text)).toMatchObject(receipt);
  const dns = await call("setup_cloudflare_dns", { domain: "example.test", provider_id: provider, register_domain: true, add_mx: true, force_mx_switch: true, mx_server: "inbound.example.test" });
  expect(dns.isError).not.toBe(true);
  const requests = await stub.list("dns-setup-requests");
  expect(requests).toHaveLength(2);
  expect(requests.find(row => row.operation === "setup")).toMatchObject({ domain: "example.test", provider_id: provider, add_mx: true, force_mx_switch: true });
  expect(requests.find(row => row.operation === "setup-cloudflare")).toMatchObject({ register_provider: true, mx_server: "inbound.example.test", add_mx: true, force_mx_switch: true });
});
test("purchase and inline token inputs fail before any setup request", async () => {
  for (const [name, extra] of [["setup_domain_for_email", { contact: {} }], ["setup_domain_for_email", { duration_years: 1 }], ["setup_cloudflare_dns", { cloudflare_token: "" }]] as const) {
    expect((await call(name, { domain: "example.test", provider_id: provider, ...extra })).isError).toBe(true);
  }
  expect(await stub.list("dns-setup-requests")).toEqual([]);
});
test("blocked or processing receipts never claim setup completion", async () => {
  for (const status of ["blocked", "processing"]) {
    await stub.seed({ providers: [{ id: provider, name: "fixture", type: "ses", active: true }], "dns-setup-results": [{ operation: "setup", receipt: { ...receipt, job: { ...receipt.job, status, dns_published: false } } }] });
    const result = await call("setup_domain_for_email", { domain: "example.test", provider_id: provider });
    expect(result.isError).toBe(true); expect(JSON.parse(result.content[0].text).job.status).toBe(status);
    expect(JSON.parse(result.content[0].text).error).toMatchObject({code:"provisioning_incomplete",retryable:false});
  }
});
