import { ingestBindings, IngestApiError, type IngestBinding } from "./ingest-api.js";
import type { TenantScopedStore } from "./store.js";
import { resourceSpecForPath } from "./resources.js";
import { evaluateInboundReceiptRoute } from "./inbound-receipt-route.js";
import { createHash } from "node:crypto";

export interface SesInboundSetupInput { domain: string; bucket: string; region?: string; prefix?: string; catch_all?: boolean }
export interface SesInboundSetupCloud { send(service: "s3" | "ses" | "sts", operation: string, input: Record<string, unknown>): Promise<any>; close(): void }
export type SesInboundSetupCloudFactory = (binding: IngestBinding, signal: AbortSignal) => SesInboundSetupCloud;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const missing = (error: any) => ["NotFound", "NoSuchBucket", "NoSuchBucketPolicy", "NoSuchPublicAccessBlockConfiguration", "RuleDoesNotExist", "RuleSetDoesNotExist"].includes(error?.name) || error?.$metadata?.httpStatusCode === 404;

/** Configure only an operator-bound bucket and SES receipt rule; never start a worker. */
export async function setupBoundSesInbound(scoped: TenantScopedStore, tenant: string, input: SesInboundSetupInput, env: NodeJS.ProcessEnv, factory: SesInboundSetupCloudFactory = createSesInboundSetupCloud, parentSignal?: AbortSignal) {
  if (Object.keys(input).some(key => !["domain", "bucket", "region", "prefix", "catch_all"].includes(key)) || ["domain", "bucket"].some(key => typeof input[key as "domain"] !== "string" || !input[key as "domain"].trim()) || ["region", "prefix"].some(key => input[key as "region"] !== undefined && (typeof input[key as "region"] !== "string" || !input[key as "region"]!.trim())) || (input.catch_all !== undefined && typeof input.catch_all !== "boolean")) throw new IngestApiError("Invalid SES inbound setup options.");
  if (input.catch_all) throw new IngestApiError("Subdomain catch-all requires separately authorized inbound domain routes; this operation configures the exact bound domain only.");
  const domain = input.domain.trim().toLowerCase();
  const candidates = ingestBindings(env).filter(b => b.tenant_id === tenant && b.domain === domain && b.bucket === input.bucket);
  if (candidates.length !== 1) throw new IngestApiError("Select one registered tenant/domain/bucket ingest binding.", 404);
  const binding = candidates[0]!;
  for (const key of ["region", "prefix"] as const) if (input[key] !== undefined && input[key] !== binding[key]) throw new IngestApiError(`${key} must match the server ingest binding.`);
  if (!binding.queue_url || !binding.rule_set || !binding.rule_name || !binding.provider_id) throw new IngestApiError("SES setup requires explicit queue_url, rule_set, rule_name and provider_id in the server ingest binding.", 503);
  const partition = binding.region.startsWith("us-gov-") ? "aws-us-gov" : binding.region.startsWith("cn-") ? "aws-cn" : "aws";
  const queue = new URL(binding.queue_url), account = queue.pathname.split("/")[1]!;
  if (queue.hostname !== `sqs.${binding.region}.amazonaws.com${partition === "aws-cn" ? ".cn" : ""}`) throw new IngestApiError("Queue account and region must match the ingest binding.", 409);
  const validateRegistry = async () => {
    const source = await scoped.getResource(resourceSpecForPath("sources")!, binding.source_id);
    const provider = await scoped.getResource(resourceSpecForPath("providers")!, binding.provider_id!);
    const registered = await scoped.getDomainByName(domain);
    if (!source || !["s3", "ses_s3"].includes(String(source.type)) || source.status !== "active" || (source.provider_id && source.provider_id !== binding.provider_id) || !provider || provider.type !== "ses" || !registered || registered.provider !== binding.provider_id) throw new IngestApiError("Active source, SES provider and domain must belong to this tenant and binding.", 409);
  };
  await validateRegistry();
  const signal = AbortSignal.any([AbortSignal.timeout(25000), ...(parentSignal ? [parentSignal] : [])]);
  signal.throwIfAborted();
  const cloud = factory(binding, signal);
  const changed: string[] = [], attempted: string[] = [];
  const mutate = async (service: "s3" | "ses", operation: string, request: Record<string, unknown>, step: string) => {
    signal.throwIfAborted(); await validateRegistry(); attempted.push(step); await cloud.send(service, operation, request); changed.push(step);
  };
  const optional = async (service: "s3" | "ses", operation: string, request: Record<string, unknown>) => { try { return await cloud.send(service, operation, request); } catch (error) { if (missing(error)) return null; throw error; } };
  const Bucket = binding.bucket, ExpectedBucketOwner = account;
  try {
    const identity = await cloud.send("sts", "GetCallerIdentity", {});
    if (identity.Account !== account || !String(identity.Arn).startsWith(`arn:${partition}:`)) throw new IngestApiError("Server AWS identity does not match the explicitly bound account.", 409);
    const [head, policyResponse, active, described] = await Promise.all([
      optional("s3", "HeadBucket", { Bucket, ExpectedBucketOwner }),
      optional("s3", "GetBucketPolicy", { Bucket, ExpectedBucketOwner }),
      cloud.send("ses", "DescribeActiveReceiptRuleSet", {}),
      optional("ses", "DescribeReceiptRuleSet", { RuleSetName: binding.rule_set }),
    ]);
    if (active.Metadata?.Name && active.Metadata.Name !== binding.rule_set) throw new IngestApiError("A different SES rule set is active; switching it requires operator topology review.", 409);
    const publicBlock = { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true };
    if (head) {
      const protection = await cloud.send("s3", "GetPublicAccessBlock", { Bucket, ExpectedBucketOwner });
      if (Object.keys(publicBlock).some(key => protection.PublicAccessBlockConfiguration?.[key] !== true)) throw new IngestApiError("Existing bucket must block public access before receiving email.", 409);
      const location = await cloud.send("s3", "GetBucketLocation", { Bucket, ExpectedBucketOwner });
      if ((location.LocationConstraint || "us-east-1") !== binding.region) throw new IngestApiError("Bound bucket exists in another region.", 409);
    }
    let policy: any = { Version: "2012-10-17", Statement: [] };
    if (policyResponse) {
      if (typeof policyResponse.Policy !== "string" || policyResponse.Policy.length > 65536) throw new IngestApiError("Existing bucket policy is invalid or too large.", 409);
      try { policy = JSON.parse(policyResponse.Policy); } catch { throw new IngestApiError("Existing bucket policy is invalid.", 409); }
      if (!Array.isArray(policy.Statement) || policy.Statement.length > 100 || policy.Statement.some((s: any) => !s || s.Effect === "Deny")) throw new IngestApiError("Existing bucket policy requires operator review.", 409);
    }
    const sid = `EmailsInbound${createHash("sha256").update(`${tenant}:${binding.source_id}`).digest("hex").slice(0,24)}`;
    const grant = { Sid: sid, Effect: "Allow", Principal: { Service: "ses.amazonaws.com" }, Action: "s3:PutObject", Resource: `arn:${partition}:s3:::${Bucket}/${binding.prefix}*`, Condition: { StringEquals: { "AWS:SourceAccount": account }, ArnEquals: { "AWS:SourceArn": `arn:${partition}:ses:${binding.region}:${account}:receipt-rule-set/${binding.rule_set}:receipt-rule/${binding.rule_name}` } } };
    const existingGrant = policy.Statement.filter((s: any) => s.Sid === sid);
    if (existingGrant.length > 1 || (existingGrant.length && !same(existingGrant[0], grant))) throw new IngestApiError("Existing bound policy grant conflicts with this setup.", 409);
    const nextPolicy = existingGrant.length ? policy : { ...policy, Statement: [...policy.Statement, grant] };
    const rules = described?.Rules ?? [];
    if (!Array.isArray(rules)) throw new IngestApiError("SES rule inventory is invalid.", 409);
    const existingRules = rules.filter((r: any) => r.Name === binding.rule_name);
    if (existingRules.length > 1) throw new IngestApiError("SES rule identity is ambiguous.", 409);
    const desired = { Name: binding.rule_name, Enabled: true, ScanEnabled: true, Recipients: [domain], Actions: [{ S3Action: { BucketName: Bucket, ObjectKeyPrefix: binding.prefix } }] };
    const selected = existingRules[0] ?? desired;
    if (!selected.Enabled || !same(selected.Recipients, [domain]) || !selected.Actions?.some((a: any) => a.S3Action?.BucketName === Bucket && a.S3Action.ObjectKeyPrefix === binding.prefix)) throw new IngestApiError("Existing receipt rule conflicts with the exact domain/bucket binding.", 409);
    const planned = existingRules.length ? rules : [...rules, desired];
    const route = evaluateInboundReceiptRoute(planned, domain, Bucket);
    if (!route.ready || route.objectKeyPrefix !== binding.prefix) throw new IngestApiError("The planned receipt rule is blocked or targets another prefix.", 409);
    if (!head) await mutate("s3", "CreateBucket", { Bucket, ...(binding.region === "us-east-1" ? {} : { CreateBucketConfiguration: { LocationConstraint: binding.region } }), ObjectOwnership: "BucketOwnerEnforced" }, "bucket_created");
    if (!head) await mutate("s3", "PutPublicAccessBlock", { Bucket, ExpectedBucketOwner, PublicAccessBlockConfiguration: publicBlock }, "public_access_blocked");
    if (!same(policy, nextPolicy)) {
      const latestPolicy = await optional("s3", "GetBucketPolicy", { Bucket, ExpectedBucketOwner });
      if (!same(latestPolicy?.Policy ? JSON.parse(latestPolicy.Policy) : null, policyResponse?.Policy ? JSON.parse(policyResponse.Policy) : null)) throw new IngestApiError("Bucket policy changed during setup; inspect it before retrying.", 409);
      await mutate("s3", "PutBucketPolicy", { Bucket, ExpectedBucketOwner, Policy: JSON.stringify(nextPolicy) }, "bucket_policy_updated");
    }
    if (!described) await mutate("ses", "CreateReceiptRuleSet", { RuleSetName: binding.rule_set }, "rule_set_created");
    if (!existingRules.length) {
      const currentRules = await cloud.send("ses", "DescribeReceiptRuleSet", { RuleSetName: binding.rule_set });
      if (!same(currentRules.Rules ?? [], rules)) throw new IngestApiError("Receipt rules changed during setup; inspect them before retrying.", 409);
      await mutate("ses", "CreateReceiptRule", { RuleSetName: binding.rule_set, Rule: desired, ...(rules.length ? { After: rules[rules.length - 1].Name } : {}) }, "receipt_rule_created");
    }
    if (!active.Metadata?.Name) {
      const currentActive = await cloud.send("ses", "DescribeActiveReceiptRuleSet", {});
      if (currentActive.Metadata?.Name) throw new IngestApiError("An active receipt rule set appeared during setup; inspect it before retrying.", 409);
      await mutate("ses", "SetActiveReceiptRuleSet", { RuleSetName: binding.rule_set }, "rule_set_activated");
    }
    const [verifiedPolicy, verifiedRules, protection] = await Promise.all([cloud.send("s3", "GetBucketPolicy", { Bucket, ExpectedBucketOwner }), cloud.send("ses", "DescribeActiveReceiptRuleSet", {}), cloud.send("s3", "GetPublicAccessBlock", { Bucket, ExpectedBucketOwner })]);
    const actualPolicy = JSON.parse(verifiedPolicy.Policy);
    const verifiedRoute = evaluateInboundReceiptRoute(verifiedRules.Rules ?? [], domain, Bucket);
    if (Object.keys(publicBlock).some(key => protection.PublicAccessBlockConfiguration?.[key] !== true) || !same(actualPolicy, nextPolicy) || verifiedRules.Metadata?.Name !== binding.rule_set || !verifiedRoute.ready || verifiedRoute.objectKeyPrefix !== binding.prefix) throw new Error("Readback did not confirm setup");
    await validateRegistry();
    return { ok: true, verified: true, domain, source_id: binding.source_id, bucket: Bucket, prefix: binding.prefix, region: binding.region, changed, attempted, changes_may_have_applied: false, worker_started: false, delivery_tested: false };
  } catch (error) {
    if (!attempted.length && error instanceof IngestApiError) throw error;
    return { ok: false, verified: false, domain, source_id: binding.source_id, bucket: Bucket, prefix: binding.prefix, region: binding.region, changed, attempted, changes_may_have_applied: attempted.length > 0, worker_started: false, delivery_tested: false, message: "Setup was not verified. Inspect the bound bucket and SES rule before retrying; attempted mutations may have applied." };
  } finally { cloud.close(); }
}

export function createSesInboundSetupCloud(binding: IngestBinding, signal: AbortSignal): SesInboundSetupCloud {
  const clients = new Map<string, any>();
  return { async send(service, operation, input) {
    const sdk: any = service === "s3" ? await import("@aws-sdk/client-s3") : service === "ses" ? await import("@aws-sdk/client-ses") : await import("@aws-sdk/client-sts");
    if (!clients.has(service)) clients.set(service, new sdk[`${service.toUpperCase()}Client`]({ region: binding.region, maxAttempts: 1 }));
    return clients.get(service).send(new sdk[`${operation}Command`](input), { abortSignal: signal });
  }, close() { for (const client of clients.values()) client.destroy(); } };
}
