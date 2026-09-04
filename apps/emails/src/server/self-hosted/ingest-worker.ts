// Self-hosted-side SES-inbound ingestion worker for the Emails self_hosted service.
//
// Runs as a long-lived ECS task alongside the self_hosted API (`emails-serve
// ingest-worker`). It long-polls a dedicated SQS queue that is fanned out from
// the shared SES-inbound SNS topic, fetches each archived raw message from the
// SES→S3 inbound bucket, normalizes it, and writes it to the SAME self_hosted
// Postgres `messages` table the /v1 API serves — so NEW inbound mail lands in
// the self_hosted automatically, with no per-machine step.
//
// Idempotency / dedup:
//   - `source_id` = the S3 object key, so redelivery of the same SQS message is
//     an upsert (never a duplicate).
//   - Before writing, we also skip anything already present under the same key
//     in `message_id` (the local→self_hosted history backfill stored the object key
//     there), so the live drain never duplicates imported history.
//
// Failure handling: any fetch/parse/DB error leaves the message on the queue
// for SQS redelivery; after the queue's maxReceiveCount it lands in the DLQ
// (nothing is silently dropped, and the durable copy remains in S3).
//
// Amendment A1 (PURE REMOTE): the worker reads/writes the shared self_hosted Postgres
// directly via the same store the serve uses. The RDS DSN is a server-side
// secret (never distributed to clients).

import { parseSesNotification } from "../../lib/inbound-realtime.js";
import { parseInboundMime } from "../../lib/inbound-mime.js";
import { createHash } from "node:crypto";
import { getSelfHostedPool, closeSelfHostedPool } from "./env.js";
import { assertServingRoleCannotBypassRls } from "./rls-guard.js";
import {
  EmailsSelfHostedStore,
  type InboundRouteResolution,
  type TenantScopedStore,
  type MessageInput,
  type InboundSourceProvenance,
  type InboundProvenanceAuditResult,
} from "./store.js";
import {
  MAX_ATTACHMENT_REPAIR_RAW_BYTES,
  normalizeAttachmentRepairCanaryMessageIds,
  repairExistingS3ObjectAttachments,
  type AttachmentRepairResult,
} from "./attachment-repair.js";

/** Minimal store surface the worker needs (kept narrow for testability). */
export interface IngestStore {
  resolveInboundRecipients(recipients: string[]): Promise<InboundRouteResolution>;
  quarantineInbound(input: {
    sourceId: string;
    bucket: string;
    objectKey: string;
    envelopeRecipients: string[];
    reason: string;
    detail?: string | null;
  }): Promise<void>;
  forTenant(tenantId: string): Pick<
    TenantScopedStore,
    "findMessageIdByKey" | "getInboundSourceProvenance" | "recordInboundSourceProvenance" | "createInboundMessageWithProvenance"
  >;
}

export interface IngestDeps {
  store: IngestStore;
  /** Fetch a raw RFC822 object from S3 as bytes. */
  fetchObject: (bucket: string, key: string) => Promise<Buffer>;
  now: () => string;
  /** Deployment-owned routing evidence for recipient-less S3 notifications. */
  prefixDomainMappings?: readonly InboundPrefixDomainMapping[];
}

export type IngestStatus = "ingested" | "duplicate" | "quarantined" | "error";

export interface IngestResult {
  status: IngestStatus;
  key?: string;
  id?: string;
  inserted?: boolean;
  tenant_ids?: string[];
  quarantined_recipients?: string[];
  reason?: string;
  error?: string;
}

export interface InboundPrefixDomainMapping {
  prefix: string;
  domain: string;
}

const INBOUND_PREFIX_DOMAIN_MAP_MAX_BYTES = 16_384;
const INBOUND_DOMAIN_RE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Parse deployment-owned S3-prefix → recipient-domain routing evidence.
 *
 * The JSON object is intentionally strict and overlap-free so one object key
 * can never select more than one domain. An absent mapping is valid, but then a
 * recipient-less event fails closed instead of inferring authority from its key.
 */
export function parseInboundPrefixDomainMap(
  raw: string | undefined,
): InboundPrefixDomainMapping[] {
  if (raw === undefined) return [];
  if (Buffer.byteLength(raw, "utf8") > INBOUND_PREFIX_DOMAIN_MAP_MAX_BYTES) {
    throw new Error("EMAILS_INGEST_PREFIX_DOMAIN_MAP exceeds its bounded size");
  }
  if (raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("EMAILS_INGEST_PREFIX_DOMAIN_MAP must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EMAILS_INGEST_PREFIX_DOMAIN_MAP must be a JSON object");
  }
  const mappings = Object.entries(parsed as Record<string, unknown>).map(([prefix, domain]) => {
    if (typeof domain !== "string") {
      throw new Error("EMAILS_INGEST_PREFIX_DOMAIN_MAP domains must be strings");
    }
    if (prefix.length === 0
      || prefix !== prefix.trim()
      || prefix.startsWith("/")
      || !prefix.endsWith("/")
      || /[\u0000-\u001F\u007F]/.test(prefix)
      || prefix.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      throw new Error("EMAILS_INGEST_PREFIX_DOMAIN_MAP contains an invalid S3 prefix");
    }
    if (domain !== domain.trim().toLowerCase() || !INBOUND_DOMAIN_RE.test(domain)) {
      throw new Error("EMAILS_INGEST_PREFIX_DOMAIN_MAP contains a non-canonical domain");
    }
    return { prefix, domain };
  }).sort((left, right) => left.prefix.localeCompare(right.prefix));
  for (let index = 1; index < mappings.length; index += 1) {
    const previous = mappings[index - 1]!;
    const current = mappings[index]!;
    if (current.prefix.startsWith(previous.prefix)) {
      throw new Error("EMAILS_INGEST_PREFIX_DOMAIN_MAP contains overlapping ambiguous prefixes");
    }
  }
  return mappings;
}

/**
 * Recover a synthetic catch-all recipient only from exact deployment-owned
 * prefix/domain configuration. The object key itself never supplies a domain.
 */
export function deriveKeyPathRecipients(
  objectKey: string,
  mappings: readonly InboundPrefixDomainMapping[],
): string[] {
  if (!objectKey || /[\u0000-\u001F\u007F]/.test(objectKey)) return [];
  const mapping = mappings.find(({ prefix }) =>
    objectKey.startsWith(prefix) && objectKey.length > prefix.length);
  return mapping ? [`catchall@${mapping.domain}`] : [];
}

export async function ingestS3Object(
  deps: IngestDeps,
  bucket: string,
  key: string,
  note: { recipients?: string[]; timestamp?: string } = {},
): Promise<IngestResult> {
  if (!bucket) return { status: "error", key, reason: "no_bucket", error: "worker has no configured inbound bucket" };
  try {
    const envelopeRecipients = note.recipients ?? [];
    let route = await deps.store.resolveInboundRecipients(envelopeRecipients);
    let routedRecipients = envelopeRecipients;
    // Fallback only when the notification carried no envelope recipients (a raw
    // S3 ObjectCreated event has none). Explicit malformed, unresolved, or partial
    // envelope evidence remains authoritative and must quarantine without
    // substitution. Recipient-less recovery requires an exact deployment-owned
    // prefix/domain mapping; the key path itself never supplies routing authority.
    if (envelopeRecipients.length === 0 && route.groups.length === 0) {
      const derived = deriveKeyPathRecipients(key, deps.prefixDomainMappings ?? []);
      if (derived.length > 0) {
        const derivedRoute = await deps.store.resolveInboundRecipients(derived);
        if (derivedRoute.groups.length > 0) {
          route = derivedRoute;
          routedRecipients = derived;
        }
      }
    }
    if (route.unresolved.length > 0 || route.groups.length === 0) {
      await deps.store.quarantineInbound({
        sourceId: key,
        bucket,
        objectKey: key,
        envelopeRecipients: routedRecipients,
        reason: route.groups.length === 0 ? "no_tenant_route" : "partial_tenant_route",
        detail: route.unresolved.length > 0
          ? `${route.unresolved.length} unresolved envelope recipient(s)`
          : "empty envelope recipients",
      });
    }
    if (route.groups.length === 0) {
      return { status: "quarantined", key, reason: "no_tenant_route", quarantined_recipients: route.unresolved };
    }

    const targets: Array<{
      group: InboundRouteResolution["groups"][number];
      scoped: Pick<
        TenantScopedStore,
        "findMessageIdByKey" | "getInboundSourceProvenance" | "recordInboundSourceProvenance" | "createInboundMessageWithProvenance"
      >;
      existing: string | null;
      provenance: InboundSourceProvenance | null;
    }> = [];
    for (const group of route.groups) {
      const scoped = deps.store.forTenant(group.tenantId);
      const existing = await scoped.findMessageIdByKey(key);
      targets.push({
        group,
        scoped,
        existing,
        provenance: existing ? await scoped.getInboundSourceProvenance(existing) : null,
      });
    }
    for (const target of targets) {
      if (target.provenance && (target.provenance.bucket !== bucket || target.provenance.object_key !== key)) {
        return { status: "error", key, reason: "provenance_conflict", error: "existing source provenance conflicts with the configured canonical source" };
      }
    }
    const raw = await deps.fetchObject(bucket, key);
    const rawSha256 = createHash("sha256").update(raw).digest("hex");
    for (const target of targets) {
      if (target.provenance && target.provenance.raw_sha256 !== rawSha256) {
        return { status: "error", key, reason: "provenance_hash_mismatch", error: "canonical source bytes no longer match immutable provenance" };
      }
    }
    // A fully provenanced replay is terminal only after the deployment's
    // canonical object has been fetched and verified against immutable bytes.
    // Preserve the fast exit here: matching duplicates are never parsed or
    // passed through any message/provenance write path.
    if (targets.every((target) => target.existing !== null && target.provenance !== null)) {
      return {
        status: "duplicate",
        key,
        id: targets[0]?.existing ?? undefined,
        inserted: false,
        tenant_ids: targets.map((target) => target.group.tenantId),
      };
    }
    // A legacy row with no provenance is bootstrapped from canonical object
    // identity only (configured bucket + exact key + raw SHA). Its stored mail
    // and attachment metadata are never reparsed or rewritten to establish
    // identity.
    if (targets.every((target) => target.existing !== null)) {
      for (const target of targets) {
        const provenanceResult = await target.scoped.recordInboundSourceProvenance({
          messageId: target.existing!,
          bucket,
          objectKey: key,
          rawSha256,
          establishedVia: "canonical_replay",
        });
        if (provenanceResult !== "recorded" && provenanceResult !== "existing_match") {
          throw new Error(`could not establish immutable legacy source provenance (${provenanceResult})`);
        }
      }
      return {
        status: "duplicate",
        key,
        id: targets[0]?.existing ?? undefined,
        inserted: false,
        tenant_ids: targets.map((target) => target.group.tenantId),
      };
    }
    const parsed = await parseInboundMime(raw);
    const receivedAt = parsed.received_at ?? note.timestamp ?? deps.now();
    const tenantIds: string[] = [];
    const ids: string[] = [];
    let insertedAny = false;
    for (const { group, scoped, existing } of targets) {
      tenantIds.push(group.tenantId);
      if (existing) {
        ids.push(existing);
        const provenanceResult = await scoped.recordInboundSourceProvenance({
          messageId: existing,
          bucket,
          objectKey: key,
          rawSha256,
          establishedVia: "canonical_replay",
        });
        if (provenanceResult !== "recorded" && provenanceResult !== "existing_match") {
          throw new Error(`could not establish immutable legacy source provenance (${provenanceResult})`);
        }
        continue;
      }
      const input: MessageInput = {
        from_addr: parsed.from_addr || "(unknown sender)",
        // MIME To/Cc headers are sender-controlled. Tenant selection and the
        // stored recipient list come only from the trusted SES envelope.
        to_addrs: group.recipients,
        cc_addrs: [],
        subject: parsed.subject || null,
        body_text: parsed.body_text,
        body_html: parsed.body_html,
        status: "received",
        direction: "inbound",
        message_id: key,
        in_reply_to: parsed.in_reply_to,
        received_at: receivedAt,
        is_read: false,
        headers: parsed.headers,
        attachments: parsed.attachments,
        source_id: key,
      };
      const atomic = await scoped.createInboundMessageWithProvenance(input, {
        bucket,
        objectKey: key,
        rawSha256,
        establishedVia: "normal_ingest",
      });
      ids.push(atomic.record.id);
      insertedAny ||= atomic.inserted;
    }
    return {
      status: insertedAny ? "ingested" : "duplicate",
      key,
      id: ids[0],
      inserted: insertedAny,
      tenant_ids: tenantIds,
      ...(route.unresolved.length > 0 ? { quarantined_recipients: route.unresolved } : {}),
    };
  } catch (err) {
    return { status: "error", key, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Process a single SQS message body (a raw SES "Received" notification, with or
 * without an SNS envelope). Pure w.r.t. its injected deps so it is unit-testable
 * without AWS or a database.
 *
 * Returns a status the caller uses to decide whether to delete the SQS message:
 * `ingested`, `duplicate`, and metadata-only `quarantined` are terminal (delete);
 * malformed or incomplete
 * notifications are errors and remain for SQS redrive/DLQ inspection.
 */
export async function processInboundNotification(
  deps: IngestDeps,
  body: string,
  defaultBucket: string | undefined,
): Promise<IngestResult> {
  const note = parseSesNotification(body);
  if (!note || !note.objectKey) return { status: "error", reason: "no_object_key", error: "notification has no S3 object key" };
  const bucket = defaultBucket;
  if (!bucket) return { status: "error", reason: "no_bucket", error: "worker has no configured inbound bucket" };
  const key = note.objectKey;
  return ingestS3Object(deps, bucket, key, { recipients: note.recipients, timestamp: note.timestamp });
}

interface WorkerOptions {
  queueUrl?: string;
  region?: string;
  maxMessages?: number;
  waitTimeSeconds?: number;
  visibilityTimeout?: number;
}

export function validateIngestWorkerConfig(config: {
  queueUrl?: string;
  bucket?: string;
  databaseUrl?: string;
}): void {
  if (!config.queueUrl) throw new Error("ingest worker requires EMAILS_INGEST_QUEUE_URL");
  if (!config.bucket) throw new Error("ingest worker requires EMAILS_INGEST_S3_BUCKET");
  if (!config.databaseUrl) throw new Error("ingest worker requires EMAILS_DATABASE_URL");
}

export function shouldDeleteIngestResult(result: IngestResult): boolean {
  return result.status === "ingested" || result.status === "duplicate" || result.status === "quarantined";
}

// ── Progress-based liveness + queue-age alarm (incident 2026-08-31) ─────────
// The ingest worker is a headless long-poll loop with no HTTP surface, so a
// wedged poll (a connection that silently stops answering instead of erroring)
// left the ECS task RUNNING but useless for days. Three guards close that gap:
//  1. every ReceiveMessage is bounded by a deadline, so a dead connection
//     becomes an ordinary error (logged + retried with backoff) instead of a
//     hang;
//  2. a tiny health endpoint reports whether a receive/ack cycle completed
//     recently — failing while the queue is non-empty — so ECS container
//     health checks replace a task whose loop stopped making progress, no
//     matter where inside the batch it wedged (S3/DB calls included);
//  3. a queue-age sampling pass reads ApproximateAgeOfOldestMessage on a
//     schedule — independently of the poll loop, so it stays honest when the
//     loop stalls — and emits an alarm event when the oldest queued message
//     crosses its threshold, so a stalled drain is loud within minutes.
export const INGEST_RECEIVE_DEADLINE_MS = 35_000; // > WaitTimeSeconds (20 s) + margin
export const INGEST_PROGRESS_STALE_DEFAULT_MS = 5 * 60_000;
export const INGEST_HEALTH_PORT_DEFAULT = 9487;
export const INGEST_QUEUE_AGE_DEFAULT_ALARM_SECONDS = 15 * 60;
export const INGEST_QUEUE_AGE_DEFAULT_POLL_SECONDS = 60;

/** Port for the progress-liveness endpoint; 0 disables the endpoint. */
export function parseIngestHealthPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return INGEST_HEALTH_PORT_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 0;
}

/** How long a completed receive/ack cycle may be absent before /ready 503s. */
export function parseIngestProgressStaleMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return INGEST_PROGRESS_STALE_DEFAULT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : INGEST_PROGRESS_STALE_DEFAULT_MS;
}

/** Oldest-message age (seconds) that emits the queue-age alarm event. */
export function parseIngestQueueAgeAlarmSeconds(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return INGEST_QUEUE_AGE_DEFAULT_ALARM_SECONDS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : INGEST_QUEUE_AGE_DEFAULT_ALARM_SECONDS;
}

/** Cadence (seconds) of the queue-age sampling pass. */
export function parseIngestQueueAgePollSeconds(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return INGEST_QUEUE_AGE_DEFAULT_POLL_SECONDS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : INGEST_QUEUE_AGE_DEFAULT_POLL_SECONDS;
}

export interface IngestHealthServer {
  /** Base URL of the health endpoint, including the bound port. */
  url: string;
  stop(): void;
}

/**
 * Shared, testable picture of ingest progress and queue state. The poll loop
 * and the queue-age sampling pass both write here; the health endpoints only
 * read, through the closures below.
 */
export interface IngestWorkerStatus {
  startedAtMs: number;
  /** Completion time of the last full receive→process→ack/delete loop pass. */
  lastCycleMs: number | null;
  /** Completion time of the last loop pass that returned at least one message. */
  lastNonEmptyCycleMs: number | null;
  cycles: number;
  counts: { ingested: number; duplicate: number; quarantined: number; error: number };
  /** Completion time of the last successful SQS queue-attributes sample. */
  lastQueueSampleMs: number | null;
  /** SQS ApproximateNumberOfMessagesVisible at the last sample. */
  queueVisible: number | null;
  /** SQS ApproximateAgeOfOldestMessage at the last sample. */
  oldestMessageAgeSeconds: number | null;
  queueSampleFailures: number;
}

export function createIngestWorkerStatus(nowMs = Date.now()): IngestWorkerStatus {
  return {
    startedAtMs: nowMs,
    lastCycleMs: null,
    lastNonEmptyCycleMs: null,
    cycles: 0,
    counts: { ingested: 0, duplicate: 0, quarantined: 0, error: 0 },
    lastQueueSampleMs: null,
    queueVisible: null,
    oldestMessageAgeSeconds: null,
    queueSampleFailures: 0,
  };
}

export type IngestLivenessReason =
  | "starting"
  | "current"
  | "stale"
  | "stale_with_work"
  | "stale_idle"
  | "queue_state_unknown";

export interface IngestLivenessDecision {
  ok: boolean;
  reason: IngestLivenessReason;
  /** Seconds since the last completed receive cycle, null before the first. */
  progressAgeSeconds: number | null;
  /** Seconds since the last queue-attributes sample, when one exists. */
  queueStateAgeSeconds: number | null;
}

export interface IngestLivenessOptions {
  /** Max ms without a completed receive cycle while the queue is non-empty. */
  staleMs: number;
  /** Completion time (ms) of the last completed receive cycle; 0 = none yet. */
  lastProgressAt: () => number;
  /**
   * Queue-state provider. Absent ⇒ progress-only liveness (stale always
   * fails). Present ⇒ the queue-age sampling pass keeps it fresh even when the
   * poll loop stalls, so a stale loop over a provably empty queue stays
   * healthy (there is no work it is failing to do) and the queue itself is
   * guarded by the age alarm. When the queue state cannot be proven fresh the
   * loop fails closed: a stalled loop over an unobserved queue is precisely the
   * incident this guard exists for.
   */
  queueState?: {
    lastSampleAt: () => number | null;
    visible: () => number | null;
    sampleStaleAfterMs: number;
  };
}

/**
 * Progress-based health decision, per the incident's acceptance: the process
 * being up is not enough — the probe must fail when the poll loop has not
 * completed a receive/ack cycle for the threshold while the queue is
 * non-empty, so ECS replaces the task.
 */
export function evaluateIngestLiveness(
  options: IngestLivenessOptions,
  nowMs = Date.now(),
): IngestLivenessDecision {
  const lastProgressAt = options.lastProgressAt();
  if (lastProgressAt <= 0) {
    return { ok: false, reason: "starting", progressAgeSeconds: null, queueStateAgeSeconds: null };
  }
  const progressAgeSeconds = Math.max(0, Math.floor((nowMs - lastProgressAt) / 1000));
  if (nowMs - lastProgressAt <= options.staleMs) {
    return { ok: true, reason: "current", progressAgeSeconds, queueStateAgeSeconds: null };
  }
  if (!options.queueState) {
    return { ok: false, reason: "stale", progressAgeSeconds, queueStateAgeSeconds: null };
  }
  const lastSampleAt = options.queueState.lastSampleAt();
  if (lastSampleAt === null) {
    return { ok: false, reason: "queue_state_unknown", progressAgeSeconds, queueStateAgeSeconds: null };
  }
  const queueStateAgeSeconds = Math.max(0, Math.floor((nowMs - lastSampleAt) / 1000));
  if (nowMs - lastSampleAt > options.queueState.sampleStaleAfterMs) {
    return { ok: false, reason: "queue_state_unknown", progressAgeSeconds, queueStateAgeSeconds };
  }
  const visible = options.queueState.visible();
  if (visible !== null && visible > 0) {
    return { ok: false, reason: "stale_with_work", progressAgeSeconds, queueStateAgeSeconds };
  }
  return { ok: true, reason: "stale_idle", progressAgeSeconds, queueStateAgeSeconds };
}

/** One scheduled pass over the queue: sample age/visibility and alarm on age. */
export function shouldEmitQueueAgeAlarm(
  ageSeconds: number | null,
  thresholdSeconds: number,
): boolean {
  return ageSeconds !== null && ageSeconds >= thresholdSeconds;
}

/** Stable, grep-able event line for the queue-age alarm hook. */
export function formatQueueAgeAlarmEvent(event: {
  ageSeconds: number;
  thresholdSeconds: number;
  visible: number | null;
}): string {
  return (
    `[ingest] queue-age-alarm event=queue_age_exceeded ` +
    `age_seconds=${event.ageSeconds} threshold_seconds=${event.thresholdSeconds} ` +
    `visible=${event.visible ?? -1}`
  );
}

export interface QueueAgeSamplerDeps {
  fetchAttributes: () => Promise<Record<string, string>>;
}

/**
 * One queue-age sample. Updates the shared status so the health probes always
 * see the freshest known queue state, and emits the alarm event when the
 * oldest queued message is at or beyond the threshold. A failed fetch is
 * recorded and retried by the caller on the next pass — never thrown.
 */
export async function sampleQueueAgeOnce(
  deps: QueueAgeSamplerDeps,
  status: IngestWorkerStatus,
  thresholdSeconds: number,
  emit: (line: string) => void = (line) => console.error(line),
  nowMs = Date.now(),
): Promise<void> {
  let attributes: Record<string, string>;
  try {
    attributes = await deps.fetchAttributes();
  } catch (err) {
    status.queueSampleFailures += 1;
    emit(`[ingest] queue-age poll failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const age = Number(attributes["ApproximateAgeOfOldestMessage"] ?? "0");
  const visible = Number(attributes["ApproximateNumberOfMessagesVisible"] ?? "0");
  status.oldestMessageAgeSeconds = Number.isFinite(age) ? age : 0;
  status.queueVisible = Number.isFinite(visible) ? visible : 0;
  status.lastQueueSampleMs = nowMs;
  if (shouldEmitQueueAgeAlarm(status.oldestMessageAgeSeconds, thresholdSeconds)) {
    emit(formatQueueAgeAlarmEvent({
      ageSeconds: status.oldestMessageAgeSeconds,
      thresholdSeconds,
      visible: status.queueVisible,
    }));
  }
}

/** JSON body served from /health — diagnostics only, never credentials. */
export function ingestProgressBody(
  options: IngestLivenessOptions & {
    status?: IngestWorkerStatus;
    queueAgeAlarmThresholdSeconds?: number;
  },
  decision: IngestLivenessDecision,
): Record<string, unknown> {
  return {
    ok: decision.ok,
    service: "ingest-worker",
    status: decision.reason,
    progress: {
      last_cycle_age_seconds: decision.progressAgeSeconds,
      cycles: options.status?.cycles ?? null,
      ...(options.status?.counts ?? {}),
    },
    queue: {
      visible: options.status?.queueVisible ?? null,
      oldest_age_seconds: options.status?.oldestMessageAgeSeconds ?? null,
      sample_age_seconds: decision.queueStateAgeSeconds,
    },
    thresholds: {
      liveness_ms: options.staleMs,
      queue_sample_stale_ms: options.queueState?.sampleStaleAfterMs ?? null,
      queue_age_alarm_seconds: options.queueAgeAlarmThresholdSeconds ?? null,
    },
  };
}

/**
 * Serves GET /ready AND GET /health on 127.0.0.1:<port> for the ingest
 * worker's own ECS container health check and for operators:
 *   /ready  — the trinary answer (200 "ok" | 503 "stale") that the ECS health
 *             check probes; queue-aware when the sampling pass is wired in.
 *   /health — JSON diagnostics: progress age, queue state, thresholds.
 * Never exposes anything beyond that; loopback-only.
 */
export function startIngestProgressHealthServer(options: {
  port: number;
  staleMs: number;
  lastProgressAt: () => number;
  status?: IngestWorkerStatus;
  queueState?: IngestLivenessOptions["queueState"];
  queueAgeAlarmThresholdSeconds?: number;
}): IngestHealthServer {
  const server = Bun.serve({
    port: options.port,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      const livenessOptions: IngestLivenessOptions = {
        staleMs: options.staleMs,
        lastProgressAt: options.lastProgressAt,
        queueState: options.queueState,
      };
      if (url.pathname === "/ready" && req.method === "GET") {
        const decision = evaluateIngestLiveness(livenessOptions, Date.now());
        return new Response(decision.ok ? "ok" : "stale", {
          status: decision.ok ? 200 : 503,
          headers: { "Content-Type": "text/plain" },
        });
      }
      if (url.pathname === "/health" && req.method === "GET") {
        const decision = evaluateIngestLiveness(livenessOptions, Date.now());
        return Response.json(ingestProgressBody(options, decision), {
          status: decision.ok ? 200 : 503,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

/**
 * Run the ingest worker loop until SIGTERM/SIGINT. Reads its wiring from the
 * environment:
 *   EMAILS_INGEST_QUEUE_URL   (required) — the SQS queue to consume
 *   EMAILS_INGEST_S3_BUCKET   (required) — operator-owned inbound bucket
 *   EMAILS_INGEST_PREFIX_DOMAIN_MAP — JSON object mapping trusted prefixes to domains
 *   AWS_REGION                 (default us-east-1)
 *   EMAILS_DATABASE_URL        (required) — self-hosted Postgres DSN
 *   EMAILS_WORKER_HEALTH_PORT  progress-liveness endpoint port (default 9487; 0 disables)
 *   EMAILS_WORKER_PROGRESS_STALE_MS — ms without a completed receive/ack cycle before /ready 503s
 *   EMAILS_INGEST_QUEUE_AGE_ALARM_SECONDS — oldest-message age (s) that emits the queue-age alarm event (default 900)
 *   EMAILS_INGEST_QUEUE_AGE_POLL_SECONDS — queue-age sampling cadence in seconds (default 60)
 */
export async function runIngestWorker(options: WorkerOptions = {}): Promise<void> {
  const region = options.region ?? process.env["AWS_REGION"] ?? "us-east-1";
  const queueUrl = options.queueUrl ?? process.env["EMAILS_INGEST_QUEUE_URL"];
  const defaultBucket = process.env["EMAILS_INGEST_S3_BUCKET"];
  const prefixDomainMappings = parseInboundPrefixDomainMap(
    process.env["EMAILS_INGEST_PREFIX_DOMAIN_MAP"],
  );
  const maxMessages = options.maxMessages ?? 10;
  const waitTimeSeconds = options.waitTimeSeconds ?? 20;
  const visibilityTimeout = options.visibilityTimeout ?? 120;

  validateIngestWorkerConfig({ queueUrl, bucket: defaultBucket, databaseUrl: process.env["EMAILS_DATABASE_URL"] });
  const configuredQueueUrl = queueUrl!;
  const configuredBucket = defaultBucket!;

  const { client } = getSelfHostedPool();
  // Fail closed: the inbound worker writes to a FORCE-RLS table. If it ever ran
  // as a role that can bypass RLS, a missing/mismatched tenant context would NOT
  // fail loudly — it would silently write cross-tenant. Refuse to start unless
  // the serving role is subject to RLS (design §6 Layer 2 / H1). This is the same
  // invariant serve.ts asserts; the headless worker had no such guard, which let
  // an RLS-incompatible writer keep running through the 0016 cutover.
  await assertServingRoleCannotBypassRls(client);
  const store = new EmailsSelfHostedStore(client);

  const [{ SQSClient, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand }, { S3Client, GetObjectCommand }] =
    await Promise.all([import("@aws-sdk/client-sqs"), import("@aws-sdk/client-s3")]);
  const sqs = new SQSClient({ region });
  const s3 = new S3Client({ region });

  const fetchObject = async (bucket: string, key: string): Promise<Buffer> => {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`empty S3 object ${bucket}/${key}`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  };

  const deps: IngestDeps = {
    store,
    fetchObject,
    now: () => new Date().toISOString(),
    prefixDomainMappings,
  };

  let running = true;
  const stop = (sig: string) => {
    console.log(`[ingest] received ${sig}, finishing current batch and shutting down`);
    running = false;
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  const status = createIngestWorkerStatus();
  const counts = status.counts;
  let lastReport = Date.now();

  // Progress-based liveness + queue-age alarm: the long-poll receive is
  // deadline-bounded (a dead connection must error, not hang) and a local
  // health endpoint reports whether the loop is still completing receive/ack
  // cycles — failing once progress goes stale while the queue is non-empty —
  // so ECS can replace a wedged task. The queue-age sampling pass below keeps
  // the /ready decision honest about queue state even when the loop stalls,
  // and emits the alarm event for the deployment-side queue-age alarm to
  // route (the CloudWatch alarm on the SQS metric is provisioned by the
  // deployment module, not by this worker).
  const healthPort = parseIngestHealthPort(process.env["EMAILS_WORKER_HEALTH_PORT"]);
  const progressStaleMs = parseIngestProgressStaleMs(process.env["EMAILS_WORKER_PROGRESS_STALE_MS"]);
  const queueAgeAlarmSeconds = parseIngestQueueAgeAlarmSeconds(
    process.env["EMAILS_INGEST_QUEUE_AGE_ALARM_SECONDS"],
  );
  const queueAgePollSeconds = parseIngestQueueAgePollSeconds(
    process.env["EMAILS_INGEST_QUEUE_AGE_POLL_SECONDS"],
  );
  // The health probe fails closed when the queue-attributes sample is older
  // than this: a stalled loop with no proof the queue is empty is the incident
  // this guard exists for.
  const queueSampleStaleAfterMs = Math.max(queueAgePollSeconds * 3, 180) * 1000;
  let health: IngestHealthServer | null = null;
  if (healthPort > 0) {
    health = startIngestProgressHealthServer({
      port: healthPort,
      staleMs: progressStaleMs,
      lastProgressAt: () => status.lastCycleMs ?? 0,
      status,
      queueState: {
        lastSampleAt: () => status.lastQueueSampleMs,
        visible: () => status.queueVisible,
        sampleStaleAfterMs: queueSampleStaleAfterMs,
      },
      queueAgeAlarmThresholdSeconds: queueAgeAlarmSeconds,
    });
    console.log(
      `[ingest] progress liveness: ${health.url}/ready (stale after ${progressStaleMs} ms; ` +
        `queue-age alarm at ${queueAgeAlarmSeconds} s, sampled every ${queueAgePollSeconds} s)`,
    );
  } else {
    console.log(
      `[ingest] progress liveness: disabled (EMAILS_WORKER_HEALTH_PORT is 0); ` +
        `queue-age alarm at ${queueAgeAlarmSeconds} s, sampled every ${queueAgePollSeconds} s`,
    );
  }

  const fetchQueueAttributes = async (): Promise<Record<string, string>> => {
    // The SDK's QueueAttributeName union omits ApproximateAgeOfOldestMessage
    // even though SQS supports it (a known SDK gap); the two literals we need
    // are cast through the type deliberately.
    const attributeNames: import("@aws-sdk/client-sqs").QueueAttributeName[] = [
      "ApproximateAgeOfOldestMessage",
      "ApproximateNumberOfMessagesVisible",
    ] as unknown as import("@aws-sdk/client-sqs").QueueAttributeName[];
    const out = await sqs.send(new GetQueueAttributesCommand({
      QueueUrl: configuredQueueUrl,
      AttributeNames: attributeNames,
    }));
    return out.Attributes ?? {};
  };
  // Independent sampling pass: it keeps queue-state knowledge fresh even when
  // the poll loop itself is wedged, and it is the scheduled pass that emits
  // the queue-age alarm event.
  void runIngestQueueAgeSampler({
    fetchAttributes: fetchQueueAttributes,
    status,
    thresholdSeconds: queueAgeAlarmSeconds,
    pollSeconds: queueAgePollSeconds,
    isRunning: () => running,
  });

  console.log(
    `[ingest] starting: queue=${configuredQueueUrl.split("/").pop()} region=${region} ` +
      `bucket=${configuredBucket}`,
  );

  while (running) {
    let messages: Array<{ Body?: string; ReceiptHandle?: string }> = [];
    try {
      const out = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: configuredQueueUrl,
          MaxNumberOfMessages: maxMessages,
          WaitTimeSeconds: waitTimeSeconds,
          VisibilityTimeout: visibilityTimeout,
        }),
        { abortSignal: AbortSignal.timeout(INGEST_RECEIVE_DEADLINE_MS) },
      );
      messages = out.Messages ?? [];
    } catch (err) {
      console.error(`[ingest] receive failed: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(5000);
      continue;
    }
    // A completed receive cycle is progress even with zero messages: it proves
    // the poll loop is alive (the wedge the 2026-08-31 incident saw stops
    // right here, with the task still 'healthy').
    status.lastCycleMs = Date.now();
    status.cycles += 1;
    if (messages.length > 0) status.lastNonEmptyCycleMs = status.lastCycleMs;

    for (const m of messages) {
      if (!running) break;
      const result = await processInboundNotification(deps, m.Body ?? "", configuredBucket);
      counts[result.status]++;

      if (!shouldDeleteIngestResult(result)) {
        console.error(`[ingest] error key=${result.key ?? "-"}: ${result.error} (left for redelivery)`);
        continue; // do NOT delete — SQS redelivers, then DLQ after maxReceiveCount
      }

      if (m.ReceiptHandle) {
        try {
          await sqs.send(new DeleteMessageCommand({ QueueUrl: configuredQueueUrl, ReceiptHandle: m.ReceiptHandle }));
        } catch (err) {
          console.error(`[ingest] delete failed key=${result.key ?? "-"}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (result.status === "ingested") {
        console.log(`[ingest] stored ${result.inserted ? "new" : "updated"} key=${result.key}`);
      }
    }

    if (Date.now() - lastReport > 30_000) {
      console.log(
        `[ingest] progress ingested=${counts.ingested} duplicate=${counts.duplicate} ` +
          `quarantined=${counts.quarantined} error=${counts.error}`,
      );
      lastReport = Date.now();
    }
  }

  console.log(
    `[ingest] stopped. totals ingested=${counts.ingested} duplicate=${counts.duplicate} ` +
      `quarantined=${counts.quarantined} error=${counts.error}`,
  );
  if (health) health.stop();
  await closeSelfHostedPool();
}

/**
 * Scheduled queue-age pass. Samples once per tick, and on each failure logs
 * and retries at the next tick; never crashes the worker.
 */
async function runIngestQueueAgeSampler(args: {
  fetchAttributes: () => Promise<Record<string, string>>;
  status: IngestWorkerStatus;
  thresholdSeconds: number;
  pollSeconds: number;
  isRunning: () => boolean;
}): Promise<void> {
  const { fetchAttributes, status, thresholdSeconds, pollSeconds, isRunning } = args;
  while (isRunning()) {
    try {
      await sampleQueueAgeOnce({ fetchAttributes }, status, thresholdSeconds);
    } catch (err) {
      console.error(`[ingest] queue-age pass failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (let waited = 0; waited < pollSeconds && isRunning(); waited += 1) {
      await sleep(1000);
    }
  }
}

interface BackfillOptions {
  prefix?: string;
  region?: string;
  limit?: number;
  /** Trusted historical envelope recipients for this bounded prefix/backfill. */
  recipients?: string[];
}

/**
 * One-shot S3 listing backfill for existing SES raw objects. This is operator
 * tooling for bootstrapping or repairing a self-hosted deployment; steady-state
 * ingestion should use the SQS worker above.
 */
export async function runIngestS3Backfill(options: BackfillOptions = {}): Promise<void> {
  const region = options.region ?? process.env["AWS_REGION"] ?? "us-east-1";
  const bucket = process.env["EMAILS_INGEST_S3_BUCKET"];
  const prefix = options.prefix ?? process.env["EMAILS_INGEST_S3_PREFIX"] ?? "";
  const envLimit = Number(process.env["EMAILS_INGEST_BACKFILL_LIMIT"] ?? "0");
  const limit = options.limit ?? (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : undefined);
  const recipients = options.recipients ?? (process.env["EMAILS_INGEST_BACKFILL_RECIPIENTS"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const prefixDomainMappings = parseInboundPrefixDomainMap(
    process.env["EMAILS_INGEST_PREFIX_DOMAIN_MAP"],
  );
  validateIngestWorkerConfig({
    queueUrl: "backfill",
    bucket,
    databaseUrl: process.env["EMAILS_DATABASE_URL"],
  });
  const configuredBucket = bucket!;

  const { client } = getSelfHostedPool();
  // Same fail-closed RLS boot guard as runIngestWorker: the backfill writes to
  // the FORCE-RLS `messages` table, so refuse to start under a role that can
  // bypass RLS (design §6 Layer 2 / H1).
  await assertServingRoleCannotBypassRls(client);
  const store = new EmailsSelfHostedStore(client);
  const [{ S3Client, GetObjectCommand, ListObjectsV2Command }] = await Promise.all([import("@aws-sdk/client-s3")]);
  const s3 = new S3Client({ region });
  const fetchObject = async (objectBucket: string, key: string): Promise<Buffer> => {
    const res = await s3.send(new GetObjectCommand({ Bucket: objectBucket, Key: key }));
    if (!res.Body) throw new Error(`empty S3 object ${objectBucket}/${key}`);
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const deps: IngestDeps = {
    store,
    fetchObject,
    now: () => new Date().toISOString(),
    prefixDomainMappings,
  };
  const counts = { ingested: 0, duplicate: 0, quarantined: 0, error: 0 };
  let scanned = 0;
  let continuationToken: string | undefined;
  console.log(`[ingest-backfill] starting: region=${region} bucket=${configuredBucket} prefix=${prefix || "(none)"}`);
  try {
    do {
      const listed = await s3.send(new ListObjectsV2Command({
        Bucket: configuredBucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      }));
      for (const object of listed.Contents ?? []) {
        if (!object.Key) continue;
        if (limit && scanned >= limit) break;
        scanned++;
        const result = await ingestS3Object(deps, configuredBucket, object.Key, { recipients });
        counts[result.status]++;
        if (result.status === "error") {
          console.error(`[ingest-backfill] error key=${result.key ?? object.Key}: ${result.error}`);
        }
      }
      if (limit && scanned >= limit) break;
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    console.log(
      `[ingest-backfill] done scanned=${scanned} ingested=${counts.ingested} duplicate=${counts.duplicate} ` +
        `quarantined=${counts.quarantined} error=${counts.error}`,
    );
  } finally {
    await closeSelfHostedPool();
  }
  if (counts.error > 0) process.exitCode = 1;
}

export interface AttachmentRepairCanaryOptions {
  region?: string;
  objectKeys: string[];
  recipients: string[];
  canaryMessageIds: string[];
  /** False by default. The operator must pass --apply deliberately. */
  apply?: boolean;
}

export function validateAttachmentRepairCanaryOptions(options: AttachmentRepairCanaryOptions): {
  objectKey: string;
  messageIds: string[];
} {
  const objectKeys = options.objectKeys.map((value) => value.trim()).filter(Boolean);
  const messageIds = normalizeAttachmentRepairCanaryMessageIds(options.canaryMessageIds);
  if (objectKeys.length !== 1) throw new Error("attachment repair requires exactly one --object-key per invocation");
  if (messageIds.length === 0) throw new Error("attachment repair requires at least one --message-id per invocation");
  if (options.recipients.length === 0) throw new Error("attachment repair requires trusted --recipient routing evidence");
  return { objectKey: objectKeys[0]!, messageIds };
}

export function attachmentRepairResultSucceeded(result: AttachmentRepairResult): boolean {
  const allowed = result.apply
    ? new Set(["repaired", "already_complete"])
    : new Set(["would_repair", "already_complete"]);
  return result.items.length > 0 && result.items.every((item) => allowed.has(item.status));
}

export function redactedAttachmentRepairReport(result: AttachmentRepairResult): Record<string, unknown> {
  return {
    mode: result.apply ? "apply" : "dry-run",
    object_key_sha256: createHash("sha256").update(result.key).digest("hex"),
    items: result.items.map((item) => ({
      tenant_id: item.tenant_id,
      ...(item.message_id ? { message_id: item.message_id } : {}),
      status: item.status,
      ...(item.attachments === undefined ? {} : { attachments: item.attachments }),
    })),
  };
}

export function finalizeAttachmentRepairCanary(
  result: AttachmentRepairResult,
  emit: (line: string) => void = (line) => console.log(line),
): AttachmentRepairResult[] {
  emit(JSON.stringify(redactedAttachmentRepairReport(result)));
  if (!attachmentRepairResultSucceeded(result)) {
    throw new Error("attachment repair did not complete successfully; no further object was attempted");
  }
  return [result];
}

/**
 * Bounded historical attachment repair. Unlike ingest-s3-backfill this never
 * lists a bucket and never invokes the generic message upsert: each requested
 * object must bind to an exact tenant-scoped canary message id, then an
 * attachment-only compare-and-swap is dry-run unless `apply` is explicit.
 */
export async function runAttachmentRepairCanary(options: AttachmentRepairCanaryOptions): Promise<AttachmentRepairResult[]> {
  const { objectKey } = validateAttachmentRepairCanaryOptions(options);
  const region = options.region ?? process.env["AWS_REGION"] ?? "us-east-1";
  if (!process.env["EMAILS_DATABASE_URL"]) throw new Error("attachment repair requires EMAILS_DATABASE_URL");
  const canonicalBucket = process.env["EMAILS_INGEST_S3_BUCKET"];
  if (!canonicalBucket) throw new Error("attachment repair requires EMAILS_INGEST_S3_BUCKET as the canonical source");

  const { client } = getSelfHostedPool();
  const store = new EmailsSelfHostedStore(client);
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region });
  const fetchObject = async (objectBucket: string, key: string): Promise<Buffer> => {
    const res = await s3.send(new GetObjectCommand({ Bucket: objectBucket, Key: key }));
    if (!res.Body) throw new Error("S3 object has no body");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > MAX_ATTACHMENT_REPAIR_RAW_BYTES) {
        throw new Error(`S3 object exceeds attachment repair source byte limit ${MAX_ATTACHMENT_REPAIR_RAW_BYTES}`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  try {
    const result = await repairExistingS3ObjectAttachments({
      canonicalBucket,
      resolveInboundRecipients: (recipients) => store.resolveInboundRecipients(recipients),
      listAttachmentRepairBindings: (bucket, key) => store.listAttachmentRepairBindings(bucket, key),
      replaceAttachmentPayloadsAtomically: (bindings, updates) =>
        store.replaceAttachmentPayloadsAtomically(bindings, updates),
      fetchObject,
    }, {
      key: objectKey,
      recipients: options.recipients,
      canaryMessageIds: options.canaryMessageIds,
      apply: options.apply === true,
    });
    return finalizeAttachmentRepairCanary(result);
  } finally {
    await closeSelfHostedPool();
  }
}

export interface InboundProvenanceAuditOptions {
  since: string;
}

export function redactedInboundProvenanceFenceReport(fenceAt: string): { fence_at: string } {
  return { fence_at: fenceAt };
}

/**
 * Privacy-safe pre-0017 cutover fence. The only emitted value is the database
 * clock timestamp used later by the aggregate provenance audit.
 */
export async function runInboundProvenanceFence(
  emit: (line: string) => void = (line) => console.log(line),
): Promise<string> {
  if (!process.env["EMAILS_DATABASE_URL"]) throw new Error("inbound provenance fence requires EMAILS_DATABASE_URL");
  const { client } = getSelfHostedPool();
  try {
    const fenceAt = await new EmailsSelfHostedStore(client).captureInboundProvenanceFence();
    emit(JSON.stringify(redactedInboundProvenanceFenceReport(fenceAt)));
    return fenceAt;
  } finally {
    await closeSelfHostedPool();
  }
}

export function validateInboundProvenanceAuditOptions(options: InboundProvenanceAuditOptions): { since: string } {
  const raw = options.since.trim();
  if (!raw) throw new Error("inbound provenance audit requires exactly one --since <ISO8601> cutoff");
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) {
    throw new Error("inbound provenance audit --since must be a valid ISO 8601 timestamp");
  }
  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  const hour = Number(match[4]!);
  const minute = Number(match[5]!);
  const second = Number(match[6]!);
  const zone = match[8]!;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const [offsetHour, offsetMinute] = zone === "Z"
    ? [0, 0]
    : zone.slice(1).split(":").map(Number);
  if (
    month < 1
    || month > 12
    || day < 1
    || day > monthDays[month - 1]!
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour! > 23
    || offsetMinute! > 59
  ) {
    throw new Error("inbound provenance audit --since must be a valid ISO 8601 timestamp");
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error("inbound provenance audit --since must be a valid ISO 8601 timestamp");
  return { since: parsed.toISOString() };
}

export function inboundProvenanceAuditSucceeded(result: InboundProvenanceAuditResult): boolean {
  return result.tenants_scanned > 0
    && result.missing_provenance === 0
    && result.invalid_provenance === 0
    && result.candidate_messages === result.valid_provenance;
}

export function redactedInboundProvenanceAuditReport(
  result: InboundProvenanceAuditResult,
): InboundProvenanceAuditResult & { status: "pass" | "fail"; gaps: number } {
  const gaps = result.missing_provenance + result.invalid_provenance;
  return {
    status: inboundProvenanceAuditSucceeded(result) ? "pass" : "fail",
    ...result,
    gaps,
  };
}

export function finalizeInboundProvenanceAudit(
  result: InboundProvenanceAuditResult,
  emit: (line: string) => void = (line) => console.log(line),
): InboundProvenanceAuditResult {
  const report = redactedInboundProvenanceAuditReport(result);
  emit(JSON.stringify(report));
  if (!inboundProvenanceAuditSucceeded(result)) {
    throw new Error(`inbound provenance audit found ${report.gaps} gap(s); API activation is forbidden`);
  }
  return result;
}

/**
 * Privacy-safe, read-only post-fence audit. The canonical bucket comes only
 * from deployment configuration; output is aggregate counts and a cutoff.
 */
export async function runInboundProvenanceAudit(
  options: InboundProvenanceAuditOptions,
): Promise<InboundProvenanceAuditResult> {
  const { since } = validateInboundProvenanceAuditOptions(options);
  if (!process.env["EMAILS_DATABASE_URL"]) throw new Error("inbound provenance audit requires EMAILS_DATABASE_URL");
  const canonicalBucket = process.env["EMAILS_INGEST_S3_BUCKET"];
  if (!canonicalBucket) throw new Error("inbound provenance audit requires EMAILS_INGEST_S3_BUCKET as the canonical source");
  const { client } = getSelfHostedPool();
  try {
    const result = await new EmailsSelfHostedStore(client).auditInboundSourceProvenance({
      since,
      canonicalBucket,
    });
    return finalizeInboundProvenanceAudit(result);
  } finally {
    await closeSelfHostedPool();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
