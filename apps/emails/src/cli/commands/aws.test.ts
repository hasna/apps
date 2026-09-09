import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { baseSeed, cliFixture, domainName, providerId, setupReceipt } from "./domain-setup.test-support.js";
let api: V1Stub, cli: ReturnType<typeof cliFixture>;
beforeAll(async () => { api = await startV1Stub({ openapi: true, resourceFilters: true }); });
afterAll(() => api.stop());
beforeEach(async () => { await api.reset(); await api.seed(baseSeed()); cli = cliFixture(api); });
afterEach(() => { expect(cli.unchanged()).toBe(true); cli.close(); });
test("fresh AWS setup CLI uses saved account access and selected server source without local AWS configuration", async () => {
  const result = cli.run(["aws", "setup-inbound", "--domain", domainName, "--provider", providerId]);
  expect(result.code, result.stderr).toBe(0); expect(result.data).toMatchObject(setupReceipt);
  expect(await api.list("ses-setup-requests")).toMatchObject([{ domain: domainName, bucket: "bound-inbound", prefix: "inbound/example.test/", region: "us-east-1" }]);
});
test("AWS selectors and subdomain scope fail before setup writes", async () => {
  for (const extra of [["--bucket", "unbound-bucket"], ["--region", "eu-west-1"], ["--prefix", "elsewhere/"], ["--catch-all"]]) {
    const result = cli.run(["aws", "setup-inbound", "--domain", domainName, ...extra]); expect(result.code).toBe(1);
  }
  expect(await api.list("ses-setup-requests")).toEqual([]);
});
test("partial server setup reports nonzero with attempted cloud steps intact", async () => {
  await api.seed({ ...baseSeed(), "ses-setup-results": [{ domain: domainName, receipt: { ...setupReceipt, ok: false, verified: false, changes_may_have_applied: true } }] });
  const result = cli.run(["aws", "setup-inbound", "--domain", domainName]); expect(result.code).toBe(1);
  expect(result.data).toMatchObject({ ok: false, attempted: ["receipt_rule_created"], changes_may_have_applied: true });
});
test("AWS status reports registry evidence without inventing an active receipt rule", () => {
  const result = cli.run(["aws", "status", "--region", "us-east-1"]); expect(result.code, result.stderr).toBe(0);
  expect(result.data).toMatchObject({ evidence: "account_registry", active_rule_set: null, live_aws_status: "unknown", sources: [{ bucket: "bound-inbound" }] });
});
