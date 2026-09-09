import { evaluateInboundReceiptRoute } from "./inbound-receipt-route.js";
import { createHash } from "node:crypto";
import { ingestBindings, IngestApiError, type IngestBinding } from "./ingest-api.js";
import { resourceSpecForPath } from "./resources.js";
import type { TenantScopedStore } from "./store.js";

type Service = "sns" | "sqs" | "ses";
export interface RealtimeSetupCloud {
  send(service: Service, operation: string, input: Record<string, unknown>): Promise<any>;
  close(): void;
}
export type RealtimeSetupCloudFactory = (binding: IngestBinding, signal: AbortSignal) => RealtimeSetupCloud;
export interface RealtimeSetupInput { domain: string; source_id?: string; rule_set?: string; rule_name?: string; region?: string; profile?: string }
const same = (a: unknown, b: unknown): boolean => {
  const normalize = (value: any): any => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
};
function policy(raw: unknown): { Version: string; Statement: any[]; [key: string]: unknown } {
  if (raw === undefined) return { Version: "2012-10-17", Statement: [] };
  if (typeof raw !== "string" || raw.length > 65536) throw new IngestApiError("Bound resource policy is invalid or too large.", 409);
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { throw new IngestApiError("Bound resource policy is invalid.", 409); }
  if (!parsed || !Array.isArray(parsed.Statement) || parsed.Statement.length > 100 || parsed.Statement.some((s: unknown) => !s || typeof s !== "object")) throw new IngestApiError("Bound resource policy statements are invalid.", 409);
  if (parsed.Statement.some((statement: any) => statement.Effect === "Deny")) throw new IngestApiError("Existing Deny policy requires manual review before realtime setup.", 409);
  return parsed;
}
function grant(existing: ReturnType<typeof policy>, statement: Record<string, unknown>) {
  const present = existing.Statement.filter(item => item.Sid === statement.Sid);
  if (present.length > 1 || (present.length === 1 && !same(present[0], statement))) throw new IngestApiError("Existing realtime policy grant conflicts with this binding.", 409);
  return present.length ? existing : { ...existing, Statement: [...existing.Statement, statement] };
}
function assertRule(rule: any, binding: IngestBinding) {
  if (!rule || rule.Name !== binding.rule_name || rule.Enabled !== true || !Array.isArray(rule.Recipients) || !rule.Recipients.length || rule.Recipients.some((recipient: unknown) => typeof recipient !== "string" || !(recipient.toLowerCase() === binding.domain || recipient.toLowerCase().endsWith(`@${binding.domain}`)))) throw new IngestApiError("SES rule must be enabled and restricted to the bound domain recipients.", 409);
  const matches = (rule.Actions ?? []).filter((action: any) => action.S3Action?.BucketName === binding.bucket && action.S3Action?.ObjectKeyPrefix === binding.prefix);
  if (matches.length !== 1) throw new IngestApiError("SES rule must have exactly one S3 action matching the bound bucket and prefix.", 409);
  if (matches[0].S3Action.TopicArn && matches[0].S3Action.TopicArn !== binding.topic_arn) throw new IngestApiError("SES S3 action already uses a different topic; change the server topology explicitly.", 409);
  return matches[0];
}
export async function setupBoundRealtime(scoped: TenantScopedStore, tenantId: string, input: RealtimeSetupInput, env: NodeJS.ProcessEnv, factory: RealtimeSetupCloudFactory = createRealtimeSetupCloud) {
  if (Object.keys(input).some(key => !["domain", "source_id", "rule_set", "rule_name", "region", "profile"].includes(key)) || Object.values(input).some(value => typeof value !== "string" || !value.trim())) throw new IngestApiError("Invalid realtime setup options.");
  if (input.profile !== undefined) throw new IngestApiError("AWS profiles are server-owned; configure the API service credentials.");
  const domain = input.domain?.trim().toLowerCase();
  const candidates = ingestBindings(env).filter(binding => binding.tenant_id === tenantId && binding.domain === domain && (!input.source_id || binding.source_id === input.source_id));
  if (candidates.length !== 1) throw new IngestApiError("Choose one registered source with a server ingest binding for this tenant and domain.", 404);
  const binding = candidates[0]!;
  if (!binding.queue_url || !binding.topic_arn || !binding.rule_set || !binding.rule_name) throw new IngestApiError("Configure queue_url, topic_arn, rule_set and rule_name in this server ingest binding before realtime setup.", 503);
  for (const key of ["region", "rule_set", "rule_name"] as const) if (input[key] !== undefined && input[key] !== binding[key]) throw new IngestApiError(`${key} must match the server ingest binding.`);
  const source = await scoped.getResource(resourceSpecForPath("sources")!, binding.source_id);
  if (!source || !["s3", "ses_s3"].includes(String(source.type)) || source.status !== "active") throw new IngestApiError("Realtime setup requires an active S3 source in this tenant.", 409);
  if (!(await scoped.getDomainByName(domain))) throw new IngestApiError("The bound domain is not registered in this tenant.", 404);
  if (binding.provider_id && !(await scoped.getResource(resourceSpecForPath("providers")!, binding.provider_id))) throw new IngestApiError("The bound provider is not registered in this tenant.", 404);
  const queue = new URL(binding.queue_url);
  const [account, queueName] = queue.pathname.slice(1).split("/");
  const arn = binding.topic_arn.split(":");
  const partition = binding.region.startsWith("cn-") ? "aws-cn" : binding.region.startsWith("us-gov-") ? "aws-us-gov" : "aws";
  if (arn.length !== 6 || arn[1] !== partition || arn[2] !== "sns" || arn[3] !== binding.region || arn[4] !== account || queue.hostname !== `sqs.${binding.region}.amazonaws.com${partition === "aws-cn" ? ".cn" : ""}` || queueName?.endsWith(".fifo") || arn[5]?.endsWith(".fifo")) throw new IngestApiError("Realtime topic and standard queue must share the bound AWS account, region and partition.", 409);
  const queueArn = `arn:${partition}:sqs:${binding.region}:${account}:${queueName}`;
  const ruleArn = `arn:${partition}:ses:${binding.region}:${account}:receipt-rule-set/${binding.rule_set}:receipt-rule/${binding.rule_name}`;
  const sid = `EmailsRealtime${createHash("sha256").update(`${tenantId}:${binding.source_id}`).digest("hex").slice(0, 24)}`;
  const queueGrant = { Sid: sid, Effect: "Allow", Principal: { Service: "sns.amazonaws.com" }, Action: "sqs:SendMessage", Resource: queueArn, Condition: { ArnEquals: { "aws:SourceArn": binding.topic_arn }, StringEquals: { "aws:SourceAccount": account } } };
  const topicGrant = { Sid: sid, Effect: "Allow", Principal: { Service: "ses.amazonaws.com" }, Action: "SNS:Publish", Resource: binding.topic_arn, Condition: { ArnEquals: { "AWS:SourceArn": ruleArn }, StringEquals: { "AWS:SourceAccount": account } } };
  const cloud = factory(binding, AbortSignal.timeout(25000));
  const changed: string[] = [], attempted: string[] = [];
  const mutate = async (service: Service, operation: string, input: Record<string, unknown>, step: string) => {
    attempted.push(step);
    return cloud.send(service, operation, input);
  };
  let stage = "preflight";
  try {
    const [queueResponse, topicResponse, described, active] = await Promise.all([
      cloud.send("sqs", "GetQueueAttributes", { QueueUrl: binding.queue_url, AttributeNames: ["QueueArn", "Policy"] }),
      cloud.send("sns", "GetTopicAttributes", { TopicArn: binding.topic_arn }),
      cloud.send("ses", "DescribeReceiptRule", { RuleSetName: binding.rule_set, RuleName: binding.rule_name }),
      cloud.send("ses", "DescribeActiveReceiptRuleSet", {}),
    ]);
    if (queueResponse.Attributes?.QueueArn !== queueArn || topicResponse.Attributes?.TopicArn !== binding.topic_arn || topicResponse.Attributes?.Owner !== account) throw new IngestApiError("Cloud resource identity differs from the server binding.", 409);
    if (active.Metadata?.Name !== binding.rule_set) throw new IngestApiError("The bound SES receipt rule set is not active.", 409);
    assertRule(described.Rule, binding);
    const targetRule = structuredClone(described.Rule);
    assertRule(targetRule, binding).S3Action.TopicArn = binding.topic_arn;
    const activeRules = active.Rules;
    if (!Array.isArray(activeRules) || activeRules.filter((rule: any) => rule.Name === binding.rule_name).length !== 1 || !same(activeRules.find((rule: any) => rule.Name === binding.rule_name), described.Rule)) throw new IngestApiError("Active SES rule evidence is missing or inconsistent.", 409);
    const plannedRules = activeRules.map((rule: any) => rule.Name === binding.rule_name ? targetRule : rule);
    const route = evaluateInboundReceiptRoute(plannedRules, domain, binding.bucket);
    if (!route.ready || route.objectKeyPrefix !== binding.prefix || route.topicArn !== binding.topic_arn) throw new IngestApiError("The configured SES action is not verifiably reachable for the bound domain.", 409);
    const queuePolicy = policy(queueResponse.Attributes?.Policy), topicPolicy = policy(topicResponse.Attributes?.Policy);
    const nextQueuePolicy = grant(queuePolicy, queueGrant), nextTopicPolicy = grant(topicPolicy, topicGrant);
    const onlySubscription = async () => {
      let subscriptionArn: string | undefined, cursor: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= 10) throw new IngestApiError("Topic subscription inventory exceeds the verification limit.", 409);
      const subscriptions = await cloud.send("sns", "ListSubscriptionsByTopic", { TopicArn: binding.topic_arn, ...(cursor ? { NextToken: cursor } : {}) });
      for (const subscription of subscriptions.Subscriptions ?? []) {
        if (subscription.Protocol !== "sqs" || subscription.Endpoint !== queueArn || subscription.Owner !== account || !String(subscription.SubscriptionArn).startsWith(`${binding.topic_arn}:`)) throw new IngestApiError("The bound topic has a conflicting or pending subscription.", 409);
        if (subscriptionArn) throw new IngestApiError("The bound topic has duplicate queue subscriptions.", 409);
        subscriptionArn = subscription.SubscriptionArn;
      }
      if (!subscriptions.NextToken) break;
      if (subscriptions.NextToken === cursor) throw new IngestApiError("Subscription inventory did not advance.", 409);
      cursor = subscriptions.NextToken;
    }
      return subscriptionArn;
    };
    let subscriptionArn = await onlySubscription();
    let beforeSubscription: any;
    if (subscriptionArn) {
      beforeSubscription = await cloud.send("sns", "GetSubscriptionAttributes", { SubscriptionArn: subscriptionArn });
      if (beforeSubscription.Attributes?.TopicArn !== binding.topic_arn || beforeSubscription.Attributes?.Endpoint !== queueArn || beforeSubscription.Attributes?.Protocol !== "sqs") throw new IngestApiError("Subscription identity differs from the binding.", 409);
      if (beforeSubscription.Attributes?.FilterPolicy && beforeSubscription.Attributes.FilterPolicy !== "{}") throw new IngestApiError("The bound subscription has an existing filter; refusing to change notification selection.", 409);
    }
    if (!same(queuePolicy, nextQueuePolicy)) { stage = "queue_policy"; await mutate("sqs", "SetQueueAttributes", { QueueUrl: binding.queue_url, Attributes: { Policy: JSON.stringify(nextQueuePolicy) } }, stage); changed.push(stage); }
    if (!same(topicPolicy, nextTopicPolicy)) { stage = "topic_policy"; await mutate("sns", "SetTopicAttributes", { TopicArn: binding.topic_arn, AttributeName: "Policy", AttributeValue: JSON.stringify(nextTopicPolicy) }, stage); changed.push(stage); }
    stage = "subscription";
    if (!subscriptionArn) {
      const subscribed = await mutate("sns", "Subscribe", { TopicArn: binding.topic_arn, Protocol: "sqs", Endpoint: queueArn, Attributes: { RawMessageDelivery: "true" }, ReturnSubscriptionArn: true }, stage);
      subscriptionArn = subscribed.SubscriptionArn;
      if (!subscriptionArn?.startsWith(`${binding.topic_arn}:`)) throw new Error("Subscription confirmation unavailable");
      changed.push(stage);
    }
    beforeSubscription ??= await cloud.send("sns", "GetSubscriptionAttributes", { SubscriptionArn: subscriptionArn });
    if (beforeSubscription.Attributes?.TopicArn !== binding.topic_arn || beforeSubscription.Attributes?.Endpoint !== queueArn || beforeSubscription.Attributes?.Protocol !== "sqs") throw new Error("Subscription identity differs");
    if (beforeSubscription.Attributes?.FilterPolicy && beforeSubscription.Attributes.FilterPolicy !== "{}") throw new IngestApiError("The bound subscription has an existing filter; refusing to change notification selection.", 409);
    if (beforeSubscription.Attributes?.RawMessageDelivery !== "true") { await mutate("sns", "SetSubscriptionAttributes", { SubscriptionArn: subscriptionArn, AttributeName: "RawMessageDelivery", AttributeValue: "true" }, "raw_delivery"); changed.push("raw_delivery"); }
    const rule = structuredClone(described.Rule);
    const action = assertRule(rule, binding);
    if (action.S3Action.TopicArn !== binding.topic_arn) { stage = "receipt_rule"; action.S3Action.TopicArn = binding.topic_arn; await mutate("ses", "UpdateReceiptRule", { RuleSetName: binding.rule_set, Rule: rule }, stage); changed.push(stage); }
    stage = "readback";
    const [verifiedQueue, verifiedTopic, verifiedSubscription, verifiedRule, verifiedActive, verifiedSubscriptionArn] = await Promise.all([
      cloud.send("sqs", "GetQueueAttributes", { QueueUrl: binding.queue_url, AttributeNames: ["QueueArn", "Policy"] }),
      cloud.send("sns", "GetTopicAttributes", { TopicArn: binding.topic_arn }),
      cloud.send("sns", "GetSubscriptionAttributes", { SubscriptionArn: subscriptionArn }),
      cloud.send("ses", "DescribeReceiptRule", { RuleSetName: binding.rule_set, RuleName: binding.rule_name }),
      cloud.send("ses", "DescribeActiveReceiptRuleSet", {}),
      onlySubscription(),
    ]);
    const verifiedRoute = evaluateInboundReceiptRoute(verifiedActive.Rules ?? [], domain, binding.bucket);
    if (!verifiedRoute.ready || verifiedRoute.objectKeyPrefix !== binding.prefix || verifiedRoute.topicArn !== binding.topic_arn || verifiedSubscriptionArn !== subscriptionArn || (verifiedSubscription.Attributes?.FilterPolicy && verifiedSubscription.Attributes.FilterPolicy !== "{}")) throw new Error("Verified route or subscription differs");
    if (verifiedQueue.Attributes?.QueueArn !== queueArn || !same(policy(verifiedQueue.Attributes?.Policy), nextQueuePolicy) || verifiedTopic.Attributes?.TopicArn !== binding.topic_arn || !same(policy(verifiedTopic.Attributes?.Policy), nextTopicPolicy) || verifiedSubscription.Attributes?.RawMessageDelivery !== "true" || verifiedSubscription.Attributes?.TopicArn !== binding.topic_arn || verifiedSubscription.Attributes?.Endpoint !== queueArn || verifiedSubscription.Attributes?.Protocol !== "sqs" || verifiedActive.Metadata?.Name !== binding.rule_set || !same(verifiedRule.Rule, rule)) throw new Error("Realtime configuration readback did not match");
    return { ok: true, configured: true, verified: true, source_id: binding.source_id, domain, topic_arn: binding.topic_arn, queue_url: binding.queue_url, queue_arn: queueArn, subscription_arn: subscriptionArn, rule_set: binding.rule_set, rule_name: binding.rule_name, changed, worker_started: false, delivery_tested: false, checked_at: new Date().toISOString() };
  } catch (error) {
    if (stage === "preflight" && error instanceof IngestApiError) throw error;
    return { ok: false, configured: false, verified: false, source_id: binding.source_id, stage, changed, attempted, changes_may_have_applied: attempted.length > 0, error: "Realtime setup did not verify. Inspect the bound cloud resources and retry the same setup; no worker was started.", worker_started: false, delivery_tested: false };
  } finally { cloud.close(); }
}
export function createRealtimeSetupCloud(binding: IngestBinding, signal: AbortSignal): RealtimeSetupCloud {
  const clients: Partial<Record<Service, any>> = {};
  return {
    async send(service, operation, input) {
      const sdk: any = service === "sns" ? await import("@aws-sdk/client-sns") : service === "sqs" ? await import("@aws-sdk/client-sqs") : await import("@aws-sdk/client-ses");
      clients[service] ??= new sdk[`${service.toUpperCase()}Client`]({ region: binding.region });
      const Command = sdk[`${operation}Command`];
      return clients[service].send(new Command(input), { abortSignal: signal });
    },
    close() { for (const client of Object.values(clients)) client.destroy(); },
  };
}
