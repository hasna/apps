import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { runDomainTool } from "./domains-impl.js";
import { Command } from "commander";
import { registerDomainCommands } from "../../cli/commands/domain.js";
let stub: V1Stub;
const id = "00000000-0000-4000-8000-000000000079", provider = "00000000-0000-4000-8000-000000000078";
const domain = { id, domain: "example.test", provider, status: "active", verified: true, notes: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const record = { type: "CNAME", name: "key._domainkey.example.test", value: "key.provider.test", purpose: "DKIM", status: "pending" };
beforeAll(async () => { stub = await startV1Stub({ apiKey: crypto.randomUUID(), seed: { providers: [{ id: provider, name: "fixture", type: "ses", active: true }], domains: [domain], "dns-records": [{ domain: domain.domain, domain_id: id, provider_id: provider, source: "live_provider", verified_for_sending: false, checked_at: "2026-09-07T00:00:00Z", records: [record] }], "dns-verifications": [domain] } }); });
beforeEach(async () => { await stub.reset(); stub.applyEnv(); });
afterEach(() => stub.clearEnv());
afterAll(() => stub.stop());
test("MCP and CLI get the same fresh DKIM records through authenticated API", async () => {
  const mcp = await runDomainTool("get_dns_records", { domain: "example.test", provider_id: provider });
  expect(mcp.isError, mcp.content[0]?.text).not.toBe(true);
  expect(JSON.parse(mcp.content[0]!.text)).toMatchObject({ source: "live_provider", records: [record] });
  const cli = new Command(); let result: unknown;
  registerDomainCommands(cli, data => { result = data; });
  await cli.parseAsync(["node", "emails", "domain", "dns", "example.test", "--provider", provider]);
  expect(result).toMatchObject({ records: [record], dkim_unavailable: null });
});
test("MCP verification uses the API result, without client provider credentials", async () => {
  const result = await runDomainTool("verify_domain", { domain: "example.test", provider_id: provider });
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  expect(JSON.parse(result.content[0]!.text)).toMatchObject({ domain: { id, verified: true } });
});
