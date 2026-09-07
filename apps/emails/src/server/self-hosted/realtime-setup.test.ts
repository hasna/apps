import { expect, test } from "bun:test";
import { setupBoundRealtime, type RealtimeSetupCloud } from "./realtime-setup.js";
import { ingestBindings } from "./ingest-api.js";
import type { TenantScopedStore } from "./store.js";
const binding = { tenant_id: "00000000-0000-0000-0000-000000000001", source_id: "source", bucket: "bound-mail", prefix: "inbound/example.com/", domain: "example.com", region: "us-east-1", queue_url: "https://sqs.us-east-1.amazonaws.com/123456789012/bound-mail", topic_arn: "arn:aws:sns:us-east-1:123456789012:bound-mail", rule_set: "emails-inbound", rule_name: "inbound-example.com" };
const queueArn = "arn:aws:sqs:us-east-1:123456789012:bound-mail";
export function realtimeFixture() {
  const calls: Array<{ service: string; operation: string; input: any }> = [];
  const preserved = { Sid: "KeepOwner", Effect: "Allow", Principal: { AWS: "123456789012" }, Action: "sqs:GetQueueAttributes", Resource: queueArn };
  const state = {
    rule: { Name: binding.rule_name, Enabled: true, Recipients: [binding.domain], ScanEnabled: true, Actions: [{ S3Action: { BucketName: binding.bucket, ObjectKeyPrefix: binding.prefix } }, { StopAction: { Scope: "RuleSet" } }] } as any,
    active: binding.rule_set,
    priorRules: [] as any[],
    queue: { QueueArn: queueArn, Policy: JSON.stringify({ Version: "2012-10-17", Statement: [preserved] }) } as any,
    topic: { TopicArn: binding.topic_arn, Owner: "123456789012", Policy: JSON.stringify({ Version: "2012-10-17", Statement: [] }) } as any,
    subscriptions: [] as any[], subscription: {} as any, closed: false,
  };
  const cloud: RealtimeSetupCloud = {
    async send(service, operation, input) {
      calls.push({ service, operation, input: structuredClone(input) });
      if (operation === "GetQueueAttributes") return { Attributes: structuredClone(state.queue) };
      if (operation === "GetTopicAttributes") return { Attributes: structuredClone(state.topic) };
      if (operation === "DescribeReceiptRule") return { Rule: structuredClone(state.rule) };
      if (operation === "DescribeActiveReceiptRuleSet") return { Metadata: { Name: state.active }, Rules: structuredClone([...state.priorRules, state.rule]) };
      if (operation === "ListSubscriptionsByTopic") return { Subscriptions: structuredClone(state.subscriptions) };
      if (operation === "SetQueueAttributes") { Object.assign(state.queue, input.Attributes); return {}; }
      if (operation === "SetTopicAttributes") { state.topic[String(input.AttributeName)] = input.AttributeValue; return {}; }
      if (operation === "Subscribe") {
        const SubscriptionArn = `${binding.topic_arn}:subscription-fixture`;
        state.subscriptions = [{ SubscriptionArn, TopicArn: binding.topic_arn, Owner: "123456789012", Protocol: "sqs", Endpoint: queueArn }];
        state.subscription = { TopicArn: binding.topic_arn, Protocol: "sqs", Endpoint: queueArn, RawMessageDelivery: "true" };
        return { SubscriptionArn };
      }
      if (operation === "GetSubscriptionAttributes") return { Attributes: structuredClone(state.subscription) };
      if (operation === "SetSubscriptionAttributes") { state.subscription[String(input.AttributeName)] = input.AttributeValue; return {}; }
      if (operation === "UpdateReceiptRule") { state.rule = structuredClone(input.Rule); return {}; }
      throw new Error(`Unexpected ${operation}`);
    },
    close() { state.closed = true; },
  };
  const scoped = { getResource: async () => ({ type: "ses_s3", status: "active" }), getDomainByName: async () => ({ domain: binding.domain }) } as unknown as TenantScopedStore;
  const env = { EMAILS_INGEST_BINDINGS: JSON.stringify([binding]) };
  const run = (input: any = { domain: binding.domain }) => setupBoundRealtime(scoped, binding.tenant_id, input, env, () => cloud);
  return { binding, calls, state, cloud, scoped, env, run, writes: () => calls.filter(call => /^(Set|Subscribe|Update)/.test(call.operation)) };
}

test("configures bound notification wiring, preserves unrelated policy/actions, and verifies an idempotent rerun", async () => {
  const f = realtimeFixture();
  expect(await f.run()).toMatchObject({ ok: true, verified: true, worker_started: false, delivery_tested: false });
  expect(f.state.rule.Actions[1]).toEqual({ StopAction: { Scope: "RuleSet" } });
  expect(JSON.parse(f.state.queue.Policy).Statement[0].Sid).toBe("KeepOwner");
  expect(JSON.parse(f.state.queue.Policy).Statement[1].Condition.ArnEquals["aws:SourceArn"]).toBe(binding.topic_arn);
  expect(JSON.parse(f.state.topic.Policy).Statement[0].Condition.ArnEquals["AWS:SourceArn"]).toContain(`receipt-rule-set/${binding.rule_set}:receipt-rule/${binding.rule_name}`);
  expect(f.state.rule.Actions[0].S3Action.TopicArn).toBe(binding.topic_arn);
  const writes = f.writes().length;
  expect(await f.run()).toMatchObject({ ok: true, changed: [] });
  expect(f.writes()).toHaveLength(writes);
  expect(f.state.closed).toBe(true);
});

test("rejects source, domain and legacy selector mismatches before cloud access", async () => {
  for (const input of [{ domain: "foreign.test" }, { domain: binding.domain, source_id: "other" }, { domain: binding.domain, rule_name: "other" }, { domain: binding.domain, rule_set: "other" }, { domain: binding.domain, region: "eu-west-1" }, { domain: binding.domain, profile: "local" }]) {
    const f = realtimeFixture();
    await expect(f.run(input)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  }
  const f = realtimeFixture(); f.scoped.getDomainByName = async () => null;
  await expect(f.run()).rejects.toThrow("not registered"); expect(f.calls).toHaveLength(0);
});

test("preflight refuses conflicting resources, inactive rules, broad recipients and foreign subscriptions without writes", async () => {
  for (const mutate of [
    (s: any) => { s.queue.QueueArn = "foreign"; },
    (s: any) => { s.topic.Owner = "999999999999"; },
    (s: any) => { s.active = "other"; },
    (s: any) => { s.rule.Enabled = false; },
    (s: any) => { s.rule.Actions.unshift({ StopAction: { Scope: "RuleSet" } }); },
    (s: any) => { s.rule.Actions.unshift({ LambdaAction: { InvocationType: "RequestResponse" } }); },
    (s: any) => { s.priorRules = [{ Name: "blocker", Enabled: true, Recipients: [binding.domain], Actions: [{ BounceAction: {} }] }]; },
    (s: any) => { s.queue.Policy = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: "sqs:SendMessage", Resource: "*", Principal: "*" }] }); },
    (s: any) => { s.topic.Policy = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: "SNS:Publish", Resource: "*", Principal: "*" }] }); },
    (s: any) => { s.rule.Recipients = []; },
    (s: any) => { s.rule.Recipients = ["foreign.test"]; },
    (s: any) => { s.rule.Actions[0].S3Action.BucketName = "foreign"; },
    (s: any) => { s.rule.Actions[0].S3Action.TopicArn = "arn:aws:sns:us-east-1:123456789012:foreign"; },
    (s: any) => { s.subscriptions = [{ Protocol: "https", Endpoint: "https://foreign.test" }]; },
  ]) {
    const f = realtimeFixture(); mutate(f.state);
    await expect(f.run()).rejects.toThrow(); expect(f.writes()).toHaveLength(0);
  }
});

test("preserves existing subscription filters instead of silently replacing them", async () => {
  const f = realtimeFixture();
  f.state.subscriptions = [{ SubscriptionArn: `${binding.topic_arn}:existing`, Owner: "123456789012", Protocol: "sqs", Endpoint: queueArn }];
  f.state.subscription = { TopicArn: binding.topic_arn, Protocol: "sqs", Endpoint: queueArn, FilterPolicy: '{"type":["special"]}' };
  await expect(f.run()).rejects.toThrow("existing filter"); expect(f.writes()).toHaveLength(0);
});

test("reports partial writes and failed readback without claiming configured success", async () => {
  for (const operation of ["SetTopicAttributes", "UpdateReceiptRule", "readback"]) {
    const f = realtimeFixture(), send = f.cloud.send.bind(f.cloud); let updates = 0;
    f.cloud.send = async (service, current, input) => {
      if (current === "UpdateReceiptRule") updates++;
      if (current === operation || (operation === "readback" && updates && current === "GetQueueAttributes")) throw new Error("secret provider exception");
      return send(service, current, input);
    };
    const result = await f.run();
    expect(result).toMatchObject({ ok: false, verified: false, worker_started: false });
    expect(result.changed).toContain("queue_policy");
    expect(JSON.stringify(result)).not.toContain("secret provider exception");
  }
});

test("binding parser rejects shared topics and malformed setup fields", () => {
  expect(() => ingestBindings({ EMAILS_INGEST_BINDINGS: JSON.stringify([binding, { ...binding, source_id: "second", prefix: "second/", queue_url: binding.queue_url + "-second" }]) })).toThrow();
  for (const extra of [{ topic_arn: "arn:arbitrary" }, { rule_name: "bad/name" }]) expect(() => ingestBindings({ EMAILS_INGEST_BINDINGS: JSON.stringify([{ ...binding, ...extra }]) })).toThrow();
});

test("actual API route enforces operator and tenant binding before AWS and returns verified configuration", async () => {
  const { handleSelfHostedRequest } = await import("./service.js");
  const { mintApiKey, verifyApiKey } = await import("@hasna/contracts/auth");
  const { testAuthDeps } = await import("./auth/test-support.js");
  const f = realtimeFixture();
  const signingSecret = "realtime-fixture-signing-secret-only";
  const client: any = { get: async () => null, many: async () => [], query: async () => ({ rows: [], rowCount: 0 }), execute: async () => {}, one: async () => ({}) };
  const deps: any = { client, store: { forTenant: () => f.scoped }, verifier: verifyApiKey({ app: "emails", signingSecret, keyStatus: async () => "active" }), sender: { provider: "ses", send: async () => { throw new Error("never send"); } }, migrations: [], version: "fixture", ...testAuthDeps(client, signingSecret), env: f.env, realtimeSetupCloud: () => f.cloud };
  const request = (scopes: string[], body: unknown = { domain: binding.domain }) => new Request("https://fixture.test/v1/inbox/setup-realtime", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": mintApiKey({ app: "emails", signingSecret, scopes }).token }, body: JSON.stringify(body) });
  expect((await handleSelfHostedRequest(deps, request(["emails:write"])))?.status).toBe(403);
  expect((await handleSelfHostedRequest(deps, request(["emails:read"])))?.status).toBe(403);
  expect((await handleSelfHostedRequest(deps, request(["emails:*"], { domain: "foreign.test" })))?.status).toBe(404);
  expect(f.calls).toHaveLength(0);
  const result = await handleSelfHostedRequest(deps, request(["emails:*"]));
  expect(result?.status).toBe(200);
  expect(await result!.json()).toMatchObject({ verified: true, worker_started: false, delivery_tested: false });
});


test("missing mutation acknowledgement reports attempted changes even when AWS applied them", async () => {
  const f = realtimeFixture(), send = f.cloud.send.bind(f.cloud);
  f.cloud.send = async (service, operation, input) => {
    const result = await send(service, operation, input);
    if (operation === "SetQueueAttributes") throw new Error("connection lost after apply");
    return result;
  };
  expect(await f.run()).toMatchObject({ ok: false, changed: [], attempted: ["queue_policy"], changes_may_have_applied: true });
  expect(JSON.parse(f.state.queue.Policy).Statement).toHaveLength(2);
});
