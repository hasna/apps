import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { Command } from "commander";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerProvisionCommands } from "./provision.js";
let stub: V1Stub;
beforeAll(async () => { stub = await startV1Stub({ openapi: true }); });
afterAll(() => stub.stop());
beforeEach(async () => { await stub.reset(); stub.applyEnv(); });
afterEach(() => stub.clearEnv());
it("reports server provisioning state and addresses without registering anything locally", async () => {
  await stub.seed({ domains: [{ id: "domain-status", domain: "example.test", provider_id: "provider", provisioning_status: "ready", dns_provider: "cloudflare", nameservers_json: [] }], addresses: [{ id: "address-status", email: "inbox@example.test", domain_id: "domain-status", provisioning_status: "ready", status: "active" }] });
  const output: unknown[] = []; const formatted: string[] = [];
  const program = new Command(); registerProvisionCommands(program, (data, text) => { output.push(data); formatted.push(text); });
  await program.parseAsync(["node", "emails", "provision", "status", "example.test", "--verbose"]);
  expect(output[0]).toMatchObject([{ domain: "example.test", provisioning: { provisioning_status: "ready" }, addresses: [{ email: "inbox@example.test" }] }]);
  expect(formatted[0]).toContain("inbox@example.test: ready");
});
it("reports an empty API registry as empty rather than an unavailable command", async () => {
  const output: unknown[] = []; const program = new Command(); registerProvisionCommands(program, (data) => output.push(data));
  await program.parseAsync(["node", "emails", "provision", "status"]);
  expect(output).toEqual([[]]);
});
