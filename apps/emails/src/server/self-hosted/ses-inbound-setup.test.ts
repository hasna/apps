import { expect, test } from "bun:test";
import { setupBoundSesInbound, type SesInboundSetupCloud } from "./ses-inbound-setup.js";
import type { TenantScopedStore } from "./store.js";
const binding = { tenant_id: "tenant", source_id: "source", provider_id: "provider", bucket: "bound-inbound", prefix: "inbound/example.test/", region: "us-east-1", domain: "example.test", queue_url: "https://sqs.us-east-1.amazonaws.com/123456789012/bound", rule_set: "bound-rules", rule_name: "bound-example" };
export function sesSetupFixture() {
  const state = { bucket: false, policy: null as any, active: undefined as string | undefined, rules: null as any, publicBlock: null as any, writes: [] as string[], closed: false, authorized: true, identity: "123456789012", fail: "" };
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
  const env = { EMAILS_INGEST_BINDINGS: JSON.stringify([binding]) };
  const run = (input: any = { domain: binding.domain, bucket: binding.bucket }) => setupBoundSesInbound(store, binding.tenant_id, input, env, async () => state.authorized, () => cloud);
  return { state, store, cloud, run, env };
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

test("activation refuses enabled unrelated or catch-all rules but preserves disabled unrelated rules", async () => {
  for (const recipients of [["other.test"], [], [".example.test"]]) {
    const f = sesSetupFixture(); f.state.rules = [{ Name: "outside", Enabled: true, Recipients: recipients, Actions: [{ BounceAction: {} }] }];
    await expect(f.run()).rejects.toThrow(); expect(f.state.writes).toEqual([]);
  }
  const f = sesSetupFixture(); f.state.rules = [{ Name: "disabled", Enabled: false, Recipients: ["other.test"], Actions: [{ BounceAction: {} }] }];
  expect(await f.run()).toMatchObject({ ok: true });
  expect(f.state.rules[0]).toMatchObject({ Name: "disabled", Enabled: false });
});
test("a rule added after creation cannot become active under this request", async () => {
  const f = sesSetupFixture(), send = f.cloud.send.bind(f.cloud);
  f.cloud.send = async (service, op, input) => {
    const result = await send(service, op, input);
    if (op === "CreateReceiptRule") f.state.rules.push({ Name: "concurrent-other", Enabled: true, Recipients: ["other.test"], Actions: [{ BounceAction: {} }] });
    return result;
  };
  expect(await f.run()).toMatchObject({ ok: false, verified: false, changes_may_have_applied: true });
  expect(f.state.writes).not.toContain("SetActiveReceiptRuleSet");
});
test("tenant suspension or binding removal during cloud reads prevents subsequent mutations", async () => {
  for (const change of ["authorization", "binding"]) {
    const f = sesSetupFixture(), send = f.cloud.send.bind(f.cloud);
    f.cloud.send = async (service, op, input) => {
      const result = await send(service, op, input);
      if (op === "GetCallerIdentity") {
        if (change === "authorization") f.state.authorized = false;
        else f.env.EMAILS_INGEST_BINDINGS = "[]";
      }
      return result;
    };
    await expect(f.run()).rejects.toThrow(); expect(f.state.writes).toEqual([]);
  }
});

test("Describe response object order does not block first activation; action order remains meaningful", async () => {
  const f = sesSetupFixture(), send = f.cloud.send.bind(f.cloud);
  f.cloud.send = async (service, operation, input) => {
    const result = await send(service, operation, input);
    if (operation === "DescribeReceiptRuleSet" && result.Rules) {
      return { ...result, Rules: result.Rules.map((rule: any) => ({ Name: rule.Name, Enabled: rule.Enabled, TlsPolicy: rule.TlsPolicy, Recipients: rule.Recipients, Actions: rule.Actions.map((action: any) => ({ S3Action: { ObjectKeyPrefix: action.S3Action.ObjectKeyPrefix, BucketName: action.S3Action.BucketName } })), ScanEnabled: rule.ScanEnabled })) };
    }
    return result;
  };
  expect(await f.run()).toMatchObject({ ok: true, verified: true });
  expect(f.state.writes).toContain("SetActiveReceiptRuleSet");
  const ordered = sesSetupFixture();
  ordered.state.rules = [{ Name: "bound-example", Enabled: true, Recipients: ["example.test"], Actions: [{ S3Action: { BucketName: "bound-inbound", ObjectKeyPrefix: "inbound/example.test/" } }, { StopAction: { Scope: "RuleSet" } }] }];
  const original = ordered.cloud.send.bind(ordered.cloud); let reads = 0;
  ordered.cloud.send = async (service, operation, input) => {
    const result = await original(service, operation, input);
    if (operation === "DescribeReceiptRuleSet" && ++reads === 2) return { Rules: result.Rules.map((rule: any) => ({ ...rule, Actions: [...rule.Actions].reverse() })) };
    return result;
  };
  expect(await ordered.run()).toMatchObject({ ok: false, verified: false });
  expect(ordered.state.writes).not.toContain("SetActiveReceiptRuleSet");
});
