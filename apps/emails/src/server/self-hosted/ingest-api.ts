import { ingestS3Object, parseInboundPrefixDomainMap, type IngestDeps, type IngestStore } from "./ingest-worker.js";
import { parseSesNotification, type InboundNotification } from "../../lib/inbound-realtime.js";
import { resourceSpecForPath } from "./resources.js";
import type { EmailsSelfHostedStore, TenantScopedStore, InboundPersistenceFence } from "./store.js";

export class IngestApiError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export interface IngestBinding { tenant_id: string; source_id: string; bucket: string; prefix: string; region: string; domain: string; queue_url?: string; provider_id?: string; topic_arn?: string; rule_set?: string; rule_name?: string }
export interface IngestCloud {
  list(prefix: string, cursor: string | undefined, limit: number): Promise<{ keys: string[]; next?: string }>;
  fetch(key: string): Promise<Buffer>;
  receive(limit: number): Promise<Array<{ body: string; receipt?: string }>>;
  acknowledge(receipt: string): Promise<void>;
  queueState(): Promise<{ visible: number | null; in_flight: number | null }>;
  close(): void;
}
export type IngestCloudFactory = (binding: IngestBinding, signal: AbortSignal) => IngestCloud;
export function ingestBindings(env: NodeJS.ProcessEnv): IngestBinding[] {
  if (!env.EMAILS_INGEST_BINDINGS?.trim()) return [];
  if (env.EMAILS_INGEST_BINDINGS.length > 65536) throw new IngestApiError("Server ingest bindings exceed the configuration size limit.", 503);
  let raw: unknown;
  try { raw = JSON.parse(env.EMAILS_INGEST_BINDINGS); } catch { throw new IngestApiError("EMAILS_INGEST_BINDINGS must be a JSON array.", 503); }
  if (!Array.isArray(raw)) throw new IngestApiError("EMAILS_INGEST_BINDINGS must be a JSON array.", 503);
  const bindings: IngestBinding[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Object.keys(row).some(key => !["tenant_id", "source_id", "bucket", "prefix", "region", "domain", "queue_url", "provider_id", "topic_arn", "rule_set", "rule_name"].includes(key)) || ["tenant_id", "source_id", "bucket", "prefix", "region", "domain"].some(key => typeof row[key] !== "string" || !row[key].trim())) throw new IngestApiError("Server ingest binding fields are invalid.", 503);
    try { parseInboundPrefixDomainMap(JSON.stringify({ [row.prefix]: row.domain })); } catch { throw new IngestApiError("Server ingest prefix or domain is invalid.", 503); }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(row.bucket) || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(row.region)) throw new IngestApiError("Server ingest bucket or region is invalid.", 503);
    if (row.provider_id !== undefined && (typeof row.provider_id !== "string" || !row.provider_id.trim())) throw new IngestApiError("Server ingest provider binding is invalid.", 503);
    if (row.queue_url !== undefined && (typeof row.queue_url !== "string" || !/^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\/\d{12}\/[^/?#]+$/.test(row.queue_url))) throw new IngestApiError("Server ingest queue URL is invalid.", 503);
    for (const field of ["rule_set", "rule_name"]) if (row[field] !== undefined && (typeof row[field] !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(row[field]))) throw new IngestApiError("Server receipt rule binding is invalid.", 503);
    if (row.topic_arn !== undefined && (typeof row.topic_arn !== "string" || !/^arn:aws(?:-cn|-us-gov)?:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/.test(row.topic_arn))) throw new IngestApiError("Server SNS topic binding is invalid.", 503);
    if (bindings.some(item => (item.tenant_id === row.tenant_id && item.source_id === row.source_id) || (item.bucket === row.bucket && (item.prefix.startsWith(row.prefix) || row.prefix.startsWith(item.prefix))) || (row.queue_url && item.queue_url === row.queue_url) || (row.topic_arn && item.topic_arn === row.topic_arn))) throw new IngestApiError("Server ingest bindings overlap or share a queue.", 503);
    bindings.push(row as IngestBinding);
  }
  return bindings;
}
export interface IngestApiInput { source_id?: string; bucket?: string; prefix?: string; region?: string; provider_id?: string; queue_url?: string; profile?: string; force?: boolean; all_buckets?: boolean; limit?: number; cursor?: string }
function matches(binding: IngestBinding, input: IngestApiInput) {
  for (const key of ["bucket", "region", "provider_id", "queue_url"] as const) if (input[key] !== undefined && input[key] !== binding[key]) throw new IngestApiError(`${key} must match the server ingest binding. Change server configuration to use another value.`);
  if (input.prefix !== undefined && (!input.prefix.startsWith(binding.prefix) || /[\u0000-\u001f\u007f]/.test(input.prefix))) throw new IngestApiError("prefix must stay inside the server-bound prefix.");
}
function notifications(body: string, depth = 0): InboundNotification[] {
  if (depth > 4) throw new Error("Notification nesting too deep");
  const parsed = JSON.parse(body);
  if (typeof parsed.Message === "string") return notifications(parsed.Message, depth + 1);
  if (Array.isArray(parsed.Records)) {
    if (!parsed.Records.length || parsed.Records.length > 25) throw new Error("Notification record count exceeds the batch limit");
    return parsed.Records.map((record: unknown) => {
      const note = parseSesNotification(JSON.stringify({ Records: [record] }));
      if (!note?.objectKey) throw new Error("Invalid notification record");
      return note;
    });
  }
  const note = parseSesNotification(body);
  if (!note?.objectKey) throw new Error("Notification has no object key");
  return [note];
}
export async function executeIngestBatch(store: EmailsSelfHostedStore, scoped: TenantScopedStore, tenantId: string, operation: "sync-s3" | "watch", input: IngestApiInput, env: NodeJS.ProcessEnv, cloudFactory: IngestCloudFactory = createIngestCloud, parentSignal?: AbortSignal) {
  parentSignal?.throwIfAborted();
  if (input.profile !== undefined) throw new IngestApiError("AWS profiles are server-owned. Configure the API service credentials; client --profile is not supported.");
  if (operation === "sync-s3" && (input.all_buckets || input.queue_url !== undefined)) throw new IngestApiError("Queue options are only supported by watch.");
  if (operation === "watch" && input.cursor !== undefined) throw new IngestApiError("S3 continuation cursors are not queue watch options.");
  if (input.all_buckets && input.source_id) throw new IngestApiError("Choose --source or --all-buckets, not both.");
  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw new IngestApiError("Batch limit must be between 1 and 10.");
  if (input.cursor !== undefined && (typeof input.cursor !== "string" || !input.cursor || input.cursor.length > 4096)) throw new IngestApiError("Invalid S3 continuation cursor.");
  const available = ingestBindings(env).filter(binding => binding.tenant_id === tenantId);
  if (!available.length) throw new IngestApiError("Configure EMAILS_INGEST_BINDINGS for this tenant and a registered S3 source on the server.", 503);
  const selected = input.source_id ? available.filter(binding => binding.source_id === input.source_id) : input.all_buckets && operation === "watch" ? available : available.length === 1 ? available : [];
  if (!selected.length) throw new IngestApiError(input.source_id ? "Source has no ingest binding in this tenant." : "Choose --source when the tenant has multiple ingest bindings.", input.source_id ? 404 : 400);
  if (selected.length > 10) throw new IngestApiError("Select one source; a batch can poll at most ten bindings.");
  const fences = new Map<string, Omit<InboundPersistenceFence, "recipients">>();
  // Validate every selected source before performing any cloud operation.
  for (const binding of selected) {
    matches(binding, input);
    const source = await scoped.getResource(resourceSpecForPath("sources")!, binding.source_id);
    if (!source) throw new IngestApiError("The bound source is not registered in this tenant.", 404);
    if (!["s3", "ses_s3"].includes(String(source.type))) throw new IngestApiError("The bound source must be an S3 source.");
    if (source.status !== "active" && !input.force) throw new IngestApiError("The source is disabled or retired. Use --force only to perform an intentional historical recovery.", 409);
    if (operation === "watch" && source.settings_json && typeof source.settings_json === "object" && (source.settings_json as Record<string, unknown>).live_sync_enabled === false) throw new IngestApiError("Live sync is disabled for this source. Enable it in the API source registry before watching.", 409);
    if (operation === "watch" && !binding.queue_url) throw new IngestApiError("Configure a dedicated queue_url in this server ingest binding before watching.", 503);
    if (binding.provider_id && source.provider_id != null && source.provider_id !== binding.provider_id) throw new IngestApiError("The source provider does not match its server binding.", 409);
    const providerId = binding.provider_id ?? (typeof source.provider_id === "string" ? source.provider_id : undefined);
    const provider = providerId ? await scoped.getResource(resourceSpecForPath("providers")!, providerId) : null;
    if (providerId && (!provider || typeof provider.type !== "string")) throw new IngestApiError("The ingest provider is not registered in this tenant.", 503);
    fences.set(binding.source_id, {
      sourceId: binding.source_id,
      sourceSnapshot: { type: String(source.type), status: String(source.status), providerId: typeof source.provider_id === "string" ? source.provider_id : null, watch: operation === "watch" },
      ...(providerId ? { providerId, providerType: String(provider!.type) } : {}),
    });
  }
  // One shared deadline keeps multi-source requests below the client timeout.
  const deadline = AbortSignal.timeout(25000);
  const signal = parentSignal ? AbortSignal.any([deadline, parentSignal]) : deadline;
  signal.throwIfAborted();
  const results = await Promise.all(selected.map(async binding => {
    const cloud = cloudFactory(binding, signal);
    const counts = { scanned: 0, ingested: 0, duplicate: 0, error: 0, notifications: 0, acknowledged: 0 };
    const prefix = input.prefix ?? binding.prefix;
    const restricted: IngestStore = {
      resolveInboundRecipients: async recipients => {
        const route = await store.resolveInboundRecipients(recipients);
        if (route.groups.some(group => group.tenantId !== tenantId) || route.unresolved.length) throw new Error("Notification does not resolve exclusively to this tenant");
        return route;
      },
      quarantineInbound: async () => { throw new Error("Notification has no authorized tenant route"); },
      forTenant: (id, recipients) => { if (id !== tenantId || !recipients?.length) throw new Error("Tenant scope mismatch"); return scoped.withInboundPersistenceFence({ ...fences.get(binding.source_id)!, recipients }); },
    };
    const deps: IngestDeps = { store: restricted, fetchObject: async (bucket, key) => { if (bucket !== binding.bucket || !key.startsWith(prefix)) throw new Error("Object is outside binding"); return cloud.fetch(key); }, now: () => new Date().toISOString(), prefixDomainMappings: [{ prefix: binding.prefix, domain: binding.domain }], providerId: binding.provider_id };
    let cursor: string | null = operation === "sync-s3" ? input.cursor ?? null : null;
    let queue: { visible: number | null; in_flight: number | null } | null = null;
    async function ingest(note: InboundNotification) {
      signal.throwIfAborted();
      if (!note.objectKey?.startsWith(prefix) || (note.bucket !== undefined && note.bucket !== binding.bucket) || (note.recipients !== undefined && (!Array.isArray(note.recipients) || note.recipients.some(value => typeof value !== "string")))) { counts.error++; return false; }
      counts.scanned++;
      const result = await ingestS3Object(deps, binding.bucket, note.objectKey, { recipients: note.recipients, timestamp: note.timestamp });
      if (result.status === "ingested" || result.status === "duplicate") { counts[result.status]++; return true; }
      counts.error++; return false;
    }
    try {
      if (operation === "sync-s3") {
        const page = await cloud.list(prefix, input.cursor, limit);
        if (page.keys.length > limit) throw new Error("S3 batch exceeded the requested limit");
        for (const key of page.keys) await ingest({ bucket: binding.bucket, objectKey: key });
        // Retrying a partial page must not skip its failed objects.
        cursor = counts.error ? input.cursor ?? null : page.next ?? null;
      } else {
        const messages = await cloud.receive(limit);
        if (messages.length > limit) throw new Error("Queue batch exceeded requested limit");
        counts.notifications = messages.length;
        for (const message of messages) {
          let safe = !!message.receipt;
          if (!message.receipt) counts.error++;
          try {
            for (const note of notifications(message.body)) if (!(await ingest(note))) safe = false;
            if (safe) { await cloud.acknowledge(message.receipt!); counts.acknowledged++; }
          } catch { counts.error++; }
        }
        queue = await cloud.queueState();
      }
      signal.throwIfAborted();
      if (counts.error === 0) await scoped.updateResource(resourceSpecForPath("sources")!, binding.source_id, { last_synced_at: new Date().toISOString() });
    } catch { counts.error++; }
    finally { cloud.close(); }
    return { source_id: binding.source_id, operation, ...counts, next_cursor: cursor, complete: counts.error === 0 && cursor === null, queue, queue_drained: queue === null ? null : queue.visible === 0 && queue.in_flight === 0, checked_at: new Date().toISOString(), scope: "server_bound_tenant_source", retry_from_start: operation === "sync-s3" && counts.error > 0 && !input.cursor };
  }));
  return { ok: results.every(result => result.error === 0), sources: results };
}
export function createIngestCloud(binding: IngestBinding, signal: AbortSignal): IngestCloud {
  let s3: import("@aws-sdk/client-s3").S3Client | undefined;
  let sqs: import("@aws-sdk/client-sqs").SQSClient | undefined;
  async function s3Client() { const sdk = await import("@aws-sdk/client-s3"); s3 ??= new sdk.S3Client({ region: binding.region }); return { sdk, client: s3 }; }
  async function sqsClient() { const sdk = await import("@aws-sdk/client-sqs"); sqs ??= new sdk.SQSClient({ region: binding.region }); return { sdk, client: sqs }; }
  return {
    async list(prefix, cursor, limit) { const { sdk, client } = await s3Client(); const result = await client.send(new sdk.ListObjectsV2Command({ Bucket: binding.bucket, Prefix: prefix, ContinuationToken: cursor, MaxKeys: limit }), { abortSignal: signal }); if (result.IsTruncated && !result.NextContinuationToken) throw new Error("S3 omitted continuation cursor"); return { keys: (result.Contents ?? []).flatMap(item => item.Key ? [item.Key] : []), next: result.IsTruncated ? result.NextContinuationToken : undefined }; },
    async fetch(key) { const { sdk, client } = await s3Client(); const result = await client.send(new sdk.GetObjectCommand({ Bucket: binding.bucket, Key: key }), { abortSignal: signal }); if (!result.Body || (result.ContentLength ?? 0) > 25000000) throw new Error("S3 message is absent or too large"); const chunks: Uint8Array[] = []; let bytes = 0; for await (const chunk of result.Body as AsyncIterable<Uint8Array>) { bytes += chunk.length; if (bytes > 25000000) throw new Error("S3 message exceeds size limit"); chunks.push(chunk); } return Buffer.concat(chunks); },
    async receive(limit) { const { sdk, client } = await sqsClient(); const result = await client.send(new sdk.ReceiveMessageCommand({ QueueUrl: binding.queue_url, MaxNumberOfMessages: limit, WaitTimeSeconds: 5, VisibilityTimeout: 60 }), { abortSignal: signal }); return (result.Messages ?? []).map(item => ({ body: item.Body ?? "", receipt: item.ReceiptHandle })); },
    async acknowledge(receipt) { const { sdk, client } = await sqsClient(); await client.send(new sdk.DeleteMessageCommand({ QueueUrl: binding.queue_url, ReceiptHandle: receipt }), { abortSignal: signal }); },
    async queueState() { const { sdk, client } = await sqsClient(); const result = await client.send(new sdk.GetQueueAttributesCommand({ QueueUrl: binding.queue_url, AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"] }), { abortSignal: signal }); const number = (key: string) => /^\d+$/.test(result.Attributes?.[key as keyof typeof result.Attributes] ?? "") ? Number(result.Attributes![key as keyof typeof result.Attributes]) : null; return { visible: number("ApproximateNumberOfMessages"), in_flight: number("ApproximateNumberOfMessagesNotVisible") }; },
    close() { s3?.destroy(); sqs?.destroy(); },
  };
}
