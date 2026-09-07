import { expect, test } from "bun:test";
import { setupBoundSesInbound, type SesInboundSetupCloud } from "./ses-inbound-setup.js";
import type { TenantScopedStore } from "./store.js";
const binding = { tenant_id: "tenant", source_id: "source", provider_id: "provider", bucket: "bound-inbound", prefix: "inbound/example.test/", region: "us-east-1", domain: "example.test", queue_url: "https://sqs.us-east-1.amazonaws.com/123456789012/bound", rule_set: "bound-rules", rule_name: "bound-example" };
export function sesSetupFixture() {
  const state = { bucket: false, policy: null as any, active: undefined as string | undefined, rules: null as any, publicBlock: null as any, writes: [] as string[], closed: false, identity: "123456789012", fail: "" };
  const notFound = () => { throw Object.assign(new Error("fixture absent"), { name: "NotFound" }); };
  const cloud: SesInboundSetupCloud = { async send(_service, op, input: any) {
    if (op === "GetCallerIdentity") return { Account: state.identity, Arn: `arn:aws:iam::${state.identity}:role/fixture` };
    if (op === "HeadBucket") return state.bucket ? {} : notFound();
    if (op === "GetBucketPolicy") return state.policy ? { Policy: JSON.stringify(state.policy) } : notFound();
    if (op === "GetBucketLocation") return {};
    if (op === "GetPublicAccessBlock") return { PublicAccessBlockConfiguration: state.publicBlock };
    if (op === "DescribeActiveReceiptRuleSet") return { Metadata: state.active ? { Name: state.active } : undefined, Rules: state.rules ?? [] };
    if (op === "DescribeReceiptRuleSet") return state.rules ? { Rules: state.rules } : notFound();
    state.writes.push(op);
    if (op === "CreateBucket") state.bucket = true;
    else if (op === "PutPublicAccessBlock") state.publicBlock = input.PublicAccessBlockConfiguration;
    else if (op === "PutBucketPolicy") state.policy = JSON.parse(input.Policy);
    else if (op === "CreateReceiptRuleSet") state.rules = [];
    else if (op === "CreateReceiptRule") state.rules.push(input.Rule);
    else if (op === "SetActiveReceiptRuleSet") state.active = input.RuleSetName;
    else throw Error(`Unexpected operation ${op}`);
    if (state.fail === op) throw Error("private provider detail");
    return {};
  }, close() { state.closed = true; } };
  const store = { getResource: async (spec: any) => spec.path === "sources" ? { type: "ses_s3", status: "active", provider_id: "provider" } : { type: "ses" }, getDomainByName: async () => ({ provider: "provider" }) } as unknown as TenantScopedStore;
  const run = (input: any = { domain: binding.domain, bucket: binding.bucket }) => setupBoundSesInbound(store, binding.tenant_id, input, { EMAILS_INGEST_BINDINGS: JSON.stringify([binding]) }, () => cloud);
  return { state, store, cloud, run };
}
test("creates only the bound bucket and rule, verifies receipt, and reruns without mutations", async () => {
  const f = sesSetupFixture();
  expect(await f.run()).toMatchObject({ ok: true, verified: true, worker_started: false, delivery_tested: false });
  expect(f.state.writes).toEqual(["CreateBucket", "PutPublicAccessBlock", "PutBucketPolicy", "CreateReceiptRuleSet", "CreateReceiptRule", "SetActiveReceiptRuleSet"]);
  expect(f.state.policy.Statement[0]).toMatchObject({ Resource: "arn:aws:s3:::bound-inbound/inbound/example.test/*", Condition: { StringEquals: { "AWS:SourceAccount": "123456789012" } } });
  const count = f.state.writes.length;
  expect(await f.run()).toMatchObject({ ok: true, changed: [] });
  expect(f.state.writes).toHaveLength(count); expect(f.state.closed).toBe(true);
});
test("identity, selectors and missing account resources reject before cloud mutations", async () => {
  for (const input of [{ domain: "foreign.test", bucket: binding.bucket }, { domain: binding.domain, bucket: "foreign-bucket" }, { domain: binding.domain, bucket: binding.bucket, prefix: "other/" }, { domain: binding.domain, bucket: binding.bucket, catch_all: true }]) {
    const f = sesSetupFixture(); await expect(f.run(input)).rejects.toThrow(); expect(f.state.writes).toEqual([]);
  }
  const f = sesSetupFixture(); f.state.identity = "999999999999";
  await expect(f.run()).rejects.toThrow("AWS identity"); expect(f.state.writes).toEqual([]);
  const other = sesSetupFixture(); other.store.getDomainByName = async () => null;
  await expect(other.run()).rejects.toThrow("must belong"); expect(other.state.writes).toEqual([]);
});
test("conflicting active rules, public bucket and deny policies never get overwritten", async () => {
  for (const mutate of [
    (s: ReturnType<typeof sesSetupFixture>["state"]) => { s.active = "unrelated"; },
    (s: ReturnType<typeof sesSetupFixture>["state"]) => { s.bucket = true; },
    (s: ReturnType<typeof sesSetupFixture>["state"]) => { s.policy = { Statement: [{ Effect: "Deny" }] }; },
    (s: ReturnType<typeof sesSetupFixture>["state"]) => { s.rules = [{ Name: "earlier", Enabled: true, Recipients: [binding.domain], Actions: [{ StopAction: { Scope: "RuleSet" } }] }]; },
  ]) {
    const f = sesSetupFixture(); mutate(f.state); await expect(f.run()).rejects.toThrow(); expect(f.state.writes).toEqual([]);
  }
});
test("ambiguous mutation failure retains attempted evidence without leaking provider errors", async () => {
  const f = sesSetupFixture(); f.state.fail = "CreateBucket";
  const result = await f.run();
  expect(result).toMatchObject({ ok: false, verified: false, changed: [], attempted: ["bucket_created"], changes_may_have_applied: true, worker_started: false });
  expect(f.state.bucket).toBe(true); expect(JSON.stringify(result)).not.toContain("private provider detail");
});

test("cloud state changes before mutations stop stale policy, rule and active-set writes", async () => {
  for (const target of ["GetBucketPolicy", "DescribeReceiptRuleSet", "DescribeActiveReceiptRuleSet"]) {
    const f = sesSetupFixture(); let calls = 0; const send = f.cloud.send.bind(f.cloud);
    f.cloud.send = async (service, operation, input) => {
      if (operation === target && ++calls === 2) {
        if (target === "GetBucketPolicy") f.state.policy = { Version: "2012-10-17", Statement: [{ Sid: "ConcurrentGrant", Effect: "Allow" }] };
        if (target === "DescribeReceiptRuleSet") f.state.rules = [{ Name: "concurrent", Enabled: true, Recipients: ["other.test"], Actions: [] }];
        if (target === "DescribeActiveReceiptRuleSet") f.state.active = "concurrent-rules";
      }
      return send(service, operation, input);
    };
    expect(await f.run()).toMatchObject({ ok: false, verified: false, changes_may_have_applied: true });
    const forbidden = target === "GetBucketPolicy" ? "PutBucketPolicy" : target === "DescribeReceiptRuleSet" ? "CreateReceiptRule" : "SetActiveReceiptRuleSet";
    expect(f.state.writes).not.toContain(forbidden);
  }
});
