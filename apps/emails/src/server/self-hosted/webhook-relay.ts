import { canonicalSender } from "../../lib/email-address.js";
import { receiveResendEvent, receiveSesNotification, type WebhookReceiptLedger, type WebhookRouting, type DeliveryEventSink } from "../webhooks/receivers.js";
import { parseInboundMime } from "../../lib/inbound-mime.js";
import { ingestBindings, type IngestBinding } from "./ingest-api.js";
import { ingestS3Object, type IngestStore } from "./ingest-worker.js";
import { resourceSpecForPath } from "./resources.js";
import type { EmailsSelfHostedStore, TenantScopedStore } from "./store.js";

export class WebhookRelayError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
interface RelayBinding { tenant_id: string; provider_id: string; type: "ses" | "resend"; secret_env?: string; api_key_env?: string; topic_arn?: string; source_id?: string }
export interface WebhookRelayDeps { fetch?: typeof fetch; verifySns?: (body: Record<string, unknown>) => Promise<boolean>; fetchObject?: (bucket: string, key: string) => Promise<Buffer> }
const MAX_BYTES = 10 * 1024 * 1024;
export async function resolveWebhookRelay(scoped: TenantScopedStore, tenant: string, selector: unknown, env: NodeJS.ProcessEnv) {
  if (selector !== undefined && (typeof selector !== "string" || !selector.trim() || selector.length > 256)) throw new WebhookRelayError("Invalid webhook provider selector.");
  let bindings: RelayBinding[];
  try {
    if (!env.EMAILS_WEBHOOK_BINDINGS || env.EMAILS_WEBHOOK_BINDINGS.length > 65536) throw new Error();
    const raw = JSON.parse(env.EMAILS_WEBHOOK_BINDINGS);
    if (!Array.isArray(raw) || !raw.length) throw new Error();
    for (const row of raw) {
      if (!row || typeof row !== "object" || Object.keys(row).some(key => !["tenant_id", "provider_id", "type", "secret_env", "api_key_env", "topic_arn", "source_id"].includes(key)) || !/^[0-9a-f-]{36}$/i.test(row.tenant_id) || typeof row.provider_id !== "string" || !row.provider_id.trim() || row.provider_id.length > 256 || !["ses", "resend"].includes(row.type)) throw new Error();
      if (row.type === "resend" && (![row.secret_env, row.api_key_env].every(value => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,127}$/.test(value)) || row.topic_arn !== undefined || row.source_id !== undefined)) throw new Error();
      if (row.type === "ses" && (typeof row.source_id !== "string" || !row.source_id.trim() || !/^arn:aws(?:-cn|-us-gov)?:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/.test(row.topic_arn) || row.secret_env !== undefined || row.api_key_env !== undefined)) throw new Error();
    }
    if (new Set(raw.map(row => `${row.tenant_id}:${row.provider_id}`)).size !== raw.length || new Set(raw.map(row => row.type === "ses" ? row.topic_arn : row.secret_env)).size !== raw.length) throw new Error();
    bindings = raw;
  } catch { throw new WebhookRelayError("Configure valid EMAILS_WEBHOOK_BINDINGS with tenant/provider identities and server secret references.", 503); }
  const selected = bindings.filter(row => row.tenant_id === tenant && (selector === undefined || row.provider_id === selector));
  if (selected.length !== 1) throw new WebhookRelayError("Select one provider with a webhook binding in this tenant.", selected.length ? 400 : 404);
  const binding = selected[0]!;
  const provider = await scoped.getResource(resourceSpecForPath("providers")!, binding.provider_id);
  if (!provider || provider.type !== binding.type) throw new WebhookRelayError("The webhook provider binding does not match this tenant's provider registry.", 409);
  let source: IngestBinding | undefined;
  if (binding.type === "resend") {
    if (!env[binding.secret_env!]?.trim() || !env[binding.api_key_env!]?.trim()) throw new WebhookRelayError("The server Resend webhook verification and Receiving API secrets must be configured.", 503);
  } else {
    source = ingestBindings(env).find(row => row.tenant_id === tenant && row.source_id === binding.source_id && row.provider_id === binding.provider_id);
    if (!source || source.topic_arn !== binding.topic_arn || source.region !== binding.topic_arn!.split(":")[3]) throw new WebhookRelayError("The SES webhook must match a server ingest source and its exact topic/region/provider.", 503);
    const registered = await scoped.getResource(resourceSpecForPath("sources")!, source.source_id);
    if (!registered || !(await scoped.getDomainByName(source.domain)) || !["s3", "ses_s3"].includes(String(registered.type)) || registered.status !== "active") throw new WebhookRelayError("The SES source must be registered and active.", 409);
  }
  return { binding, source, capability: { available: true, signature_verification: true, durable_receipts: true, provider_id: binding.provider_id, type: binding.type, max_webhook_bytes: 1048576 } };
}
async function bounded(response: Response, max = MAX_BYTES): Promise<Buffer> {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new WebhookRelayError("Provider content could not be retrieved.", 502); }
  if (Number(response.headers.get("content-length")) > max) { await response.body.cancel(); throw new WebhookRelayError("Provider content exceeds the import limit.", 413); }
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new WebhookRelayError("Provider content exceeds the import limit.", 413); } parts.push(value); }
  return Buffer.concat(parts);
}
async function resendRaw(id: string, key: string, send: typeof fetch, signal: AbortSignal) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new WebhookRelayError("Invalid Resend received email identity.");
  const response = await send(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal });
  let data; try { data = JSON.parse((await bounded(response, MAX_BYTES)).toString()); } catch (error) { if (error instanceof WebhookRelayError) throw error; throw new WebhookRelayError("Invalid Resend Receiving API content.", 502); }
  if (data.id !== id || typeof data.raw?.download_url !== "string") throw new WebhookRelayError("Resend must provide the original raw message before the webhook can be acknowledged.", 502);
  let url: URL; try { url = new URL(data.raw.download_url); } catch { throw new WebhookRelayError("Invalid provider raw download URL.", 502); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !/^(?:[a-z0-9-]+\.)+(?:resend\.com|cloudfront\.net)$/.test(url.hostname)) throw new WebhookRelayError("Provider raw download URL is outside the supported Resend CDN hosts.", 502);
  // Signed URL only; never forward the Receiving API credential to the CDN.
  const raw = await bounded(await send(url, { redirect: "error", signal }));
  const parsed = await parseInboundMime(raw);
  if (parsed.attachments.length > 100 || parsed.attachments.reduce((sum, item) => sum + item.size, 0) > MAX_BYTES) throw new WebhookRelayError("Provider attachments exceed the import limit.", 413);
  return parsed;
}
export function providerWebhookRequest(url: string, envelope: Record<string, unknown>): Request {
  if (Object.keys(envelope).some(key => !["raw_body_base64", "signature_headers"].includes(key)) || typeof envelope.raw_body_base64 !== "string" || envelope.raw_body_base64.length > 1398104) throw new WebhookRelayError("Relay requires the original provider body, at most 1 MiB.", 413);
  const raw = Buffer.from(envelope.raw_body_base64 as string, "base64");
  if (raw.length > 1048576 || raw.toString("base64") !== envelope.raw_body_base64) throw new WebhookRelayError("Relay body must use canonical base64 within 1 MiB.");
  const values = envelope.signature_headers;
  const allowed = ["content-type", "svix-id", "svix-timestamp", "svix-signature", "x-amz-sns-message-type", "x-amz-sns-topic-arn", "x-amz-sns-subscription-arn"];
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).some(name => !allowed.includes(name))) throw new WebhookRelayError("Invalid provider signature headers.");
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== "string" || value.length > 4096 || /[\r\n]/.test(value)) throw new WebhookRelayError("Invalid provider signature header value.");
    headers.set(name, value);
  }
  return new Request(url, { method: "POST", headers, body: raw });
}
export async function relayWebhook(root: EmailsSelfHostedStore, scoped: TenantScopedStore, tenant: string, selector: unknown, type: string, request: Request, env: NodeJS.ProcessEnv, deps: WebhookRelayDeps = {}): Promise<Response> {
  const { binding, source } = await resolveWebhookRelay(scoped, tenant, selector, env);
  if (type !== binding.type) throw new WebhookRelayError("Webhook route must match the selected provider type.", 409);
  const namespace = `relay:${binding.type}:${binding.provider_id}`, send = deps.fetch ?? fetch, signal = AbortSignal.timeout(25000);
  const requireScope = async (routing: WebhookRouting) => {
    const addresses = routing.addresses.map(value => typeof value === "string" ? canonicalSender(value) : null);
    if (!addresses.length || addresses.some(value => !value)) throw new WebhookRelayError("Webhook has no valid authoritative envelope.", 422);
    const unique = [...new Set(addresses as string[])];
    const route = await root.resolveInboundRecipients(unique);
    if (route.unresolved.length || route.groups.length !== 1 || route.groups[0]!.tenantId !== tenant || route.groups[0]!.recipients.length !== unique.length) throw new WebhookRelayError("Webhook envelope must belong exclusively to the authenticated tenant.", 403);
    return route;
  };
  // Empty routing is used only by the shared SES verifier's signed subscription branch.
  const ledger: WebhookReceiptLedger = {
    find: async (_provider, eventId, routing) => { if (routing.addresses.length) await requireScope(routing); else if (type !== "ses") throw new WebhookRelayError("Webhook has no authoritative envelope.", 422); return scoped.findRelayReceipt(namespace, eventId); },
    record: async (_provider, eventId, resource, routing) => { if (routing.addresses.length) await requireScope(routing); else if (type !== "ses") throw new WebhookRelayError("Webhook has no authoritative envelope.", 422); await scoped.recordRelayReceipt(namespace, eventId, resource); },
  };
  const delivery: DeliveryEventSink = async (event, routing, eventId) => {
    await requireScope(routing);
    if (!event.provider_message_id) throw new WebhookRelayError("Webhook delivery has no provider message identity.", 422);
    return scoped.createRelayDelivery(namespace, eventId, binding.provider_id, event.provider_message_id, { email_id: null, type: event.type, recipient: event.recipient ?? null, metadata: { ...(event.metadata ?? {}), provider_message_id: event.provider_message_id }, occurred_at: event.occurred_at });
  };
  let response: Response;
  if (type === "resend") response = await receiveResendEvent(request, {
    ledger, webhookSecret: () => env[binding.secret_env!], recordDeliveryEvent: delivery,
    storeInbound: async (event, routing, eventId) => {
      const route = await requireScope(routing);
      const parsed = await resendRaw(event.provider_message_id, env[binding.api_key_env!]!, send, signal);
      return scoped.createRelayInbound(namespace, eventId, { direction: "inbound", provider_id: binding.provider_id, provider_message_id: event.provider_message_id, from_addr: parsed.from_addr || event.from_address, to_addrs: route.groups[0]!.recipients, cc_addrs: [], subject: parsed.subject, body_text: parsed.body_text, body_html: parsed.body_html, headers: parsed.headers, attachments: parsed.attachments, message_id: parsed.rfc_message_id, in_reply_to: parsed.in_reply_to, received_at: event.received_at, status: "received", source_id: `${namespace}:${event.provider_message_id}` });
    },
  });
  else response = await receiveSesNotification(request, {
    ledger, env: { EMAILS_SNS_TOPIC_ARNS: binding.topic_arn, EMAILS_AWS_ACCOUNT_IDS: binding.topic_arn!.split(":")[4] }, verifySns: deps.verifySns,
    inboundSource: () => ({ bucket: source!.bucket, prefix: source!.prefix, region: source!.region, providerId: binding.provider_id }), recordDeliveryEvent: delivery,
    fetchUrl: async url => { const response = await send(url, { redirect: "error", signal }); if (!response.ok) throw new WebhookRelayError("SNS subscription confirmation was not accepted.", 502); },
    ingest: async input => {
      await requireScope({ addresses: input.recipients });
      const restricted: IngestStore = { resolveInboundRecipients: recipients => requireScope({ addresses: recipients }), forTenant: id => { if (id !== tenant) throw new WebhookRelayError("Foreign ingest tenant.", 403); return scoped; }, quarantineInbound: async () => { throw new WebhookRelayError("Webhook ingest could not establish its tenant.", 422); } };
      const result = await ingestS3Object({ store: restricted, providerId: binding.provider_id, now: () => new Date().toISOString(), fetchObject: deps.fetchObject ?? (async (bucket, key) => {
        const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3"); const client = new S3Client({ region: source!.region });
        try { const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal }); if (!object.Body) throw new Error("Missing object"); return bounded(new Response(object.Body.transformToWebStream(), { headers: { "content-length": String(object.ContentLength ?? 0) } })); } finally { client.destroy(); }
      }) }, source!.bucket, input.objectKey!, { recipients: input.recipients, timestamp: input.timestamp });
      if (!result.id || !["ingested", "duplicate"].includes(result.status)) throw new WebhookRelayError("SES webhook message was not durably ingested.", 502);
      return { synced: result.inserted ? 1 : 0, resourceId: result.id };
    },
  });
  if (!response.ok) {
    if (response.status === 401) response.headers.set("X-Emails-Webhook-Verification", "rejected");
    return response;
  }
  const result = await response.json() as Record<string, unknown>;
  if (result.ok !== true || result.ignored !== undefined || !(result.duplicate === true || result.confirmed === true || typeof result.id === "string" || typeof result.event_id === "string" || typeof result.synced === "number")) throw new WebhookRelayError("Webhook was not completed; no successful relay receipt is available.", 422);
  return Response.json({ ...result, completed: true, provider_id: binding.provider_id });
}
