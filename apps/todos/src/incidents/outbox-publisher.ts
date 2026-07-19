import {
  ACTIVE_INCIDENT_STATUSES,
  INCIDENT_BLOCKED_SCOPE_PATTERNS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  incidentEventId,
  incidentTransitionId,
  isCanonicalIncidentTimestamp,
  normalizeIncidentAuthorityId,
  stableIncidentFingerprint,
  type IncidentProjectionEvent,
} from "./contracts.js";
import type { IncidentOutboxRecord, IncidentOutboxStatus } from "./postgres-store.js";

export const INCIDENT_PUBLISHER_RESPONSE_LIMIT_BYTES = 64 * 1024;
export const INCIDENT_PUBLISHER_LEASE_SAFETY_MS = 1_000;
export const INCIDENT_PUBLISHER_MAX_REMOTE_WINDOWS = 4;

export interface IncidentOutboxPublisherCallOptions {
  signal: AbortSignal;
}

export interface IncidentOutboxPublisherApi {
  status(options: IncidentOutboxPublisherCallOptions): Promise<IncidentOutboxStatus>;
  claim(
    input: { limit: 1; lease_seconds: number },
    options: IncidentOutboxPublisherCallOptions,
  ): Promise<IncidentOutboxRecord[]>;
  ack(
    eventId: string,
    input: { lease_token: string; delivery_id: string },
    options: IncidentOutboxPublisherCallOptions,
  ): Promise<IncidentOutboxRecord>;
  fail(
    eventId: string,
    input: { lease_token: string; failure_code: string; failure: string },
    options: IncidentOutboxPublisherCallOptions,
  ): Promise<IncidentOutboxRecord>;
}

export interface IncidentOutboxOperatorApi extends IncidentOutboxPublisherApi {
  listDead(
    input: { limit?: number; before_created_at?: string; before_event_id?: string },
    options: IncidentOutboxPublisherCallOptions,
  ): Promise<IncidentOutboxRecord[]>;
  getDead(eventId: string, options: IncidentOutboxPublisherCallOptions): Promise<IncidentOutboxRecord | null>;
  requeue(
    eventId: string,
    input: { expected_attempts: number; idempotency_key: string; reason: string },
    options: IncidentOutboxPublisherCallOptions,
  ): Promise<IncidentOutboxRecord>;
}

export interface IncidentOutboxHttpApiOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface IncidentPublisherOptions {
  outbox: IncidentOutboxPublisherApi;
  projectorBaseUrl: string;
  projectorApiKey: string;
  limit: number;
  leaseSeconds: number;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type IncidentPublisherEventResult =
  | { event_id: string; status: "acked"; message_id: number; replayed: boolean }
  | { event_id: string; status: "failed" | "fail_pending"; failure_code: string }
  | { event_id: string; status: "ack_pending" | "delivery_pending"; message_id?: number };

export interface IncidentPublisherResult {
  ok: boolean;
  outcome:
    | "complete"
    | "claim_failed"
    | "claim_invalid"
    | "lease_insufficient"
    | "failed"
    | "fail_pending"
    | "ack_pending"
    | "delivery_pending";
  claimed: number;
  acked: number;
  failed: number;
  events: IncidentPublisherEventResult[];
}

export interface IncidentPublisherStatusResult {
  ok: boolean;
  outcome: "status" | "status_failed";
  status?: IncidentOutboxStatus;
}

interface ProjectorSuccess {
  ok: true;
  messageId: number;
  replayed: boolean;
}

interface ProjectorFailure {
  ok: false;
  code: string;
  ambiguous: boolean;
}

type ProjectorAttempt = ProjectorSuccess | ProjectorFailure;

class OperationTimeoutError extends Error {
  constructor() {
    super("OPERATION_TIMEOUT");
    this.name = "OperationTimeoutError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const INCIDENT_PROJECTION_EVENT_KEYS = new Set([
  "schema_version", "source", "event_id", "projection_key", "authority_id",
  "incident_id", "transition_id", "incident_version", "occurred_at", "incident",
]);
const INCIDENT_STATE_KEYS = new Set([
  "id", "title", "severity", "status", "owner", "affected_scopes", "blocked_scopes",
  "containment", "next_action", "deadline", "closure_evidence", "supersedes_id",
  "superseded_by_id", "resolved_at", "version", "created_at", "updated_at",
]);
const INCIDENT_OUTBOX_KEYS = new Set([
  "event_id", "projection_key", "incident_id", "incident_version", "depends_on_event_id",
  "payload", "status", "attempts", "next_attempt_at", "lease_token", "leased_by",
  "lease_expires_at", "delivery_id", "acked_at", "last_error", "failure_code",
  "failure_fingerprint", "consecutive_failures", "created_at", "updated_at",
]);
const INCIDENT_OUTBOX_STATUS_KEYS = new Set(["pending", "leased", "acked", "dead", "total"]);
const INCIDENT_STATUS_ENVELOPE_KEYS = new Set(["status"]);
const INCIDENT_OUTBOX_ENVELOPE_KEYS = new Set(["outbox"]);
const INCIDENT_OUTBOX_LIST_ENVELOPE_KEYS = new Set(["outbox", "count"]);

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

export function canonicalIncidentJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("INCIDENT_CANONICAL_VALUE_INVALID");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalIncidentJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalIncidentJson(object[key])}`
  )).join(",")}}`;
}

function uniqueConfigured(env: Record<string, string | undefined>, names: string[], missingCode: string, conflictCode: string): string {
  const values = names.map((name) => env[name]?.trim()).filter((value): value is string => Boolean(value));
  const distinct = [...new Set(values)];
  if (distinct.length === 0) throw new Error(missingCode);
  if (distinct.length > 1) throw new Error(conflictCode);
  return distinct[0]!;
}

function loopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

export function resolveIncidentProjectorConfig(env: Record<string, string | undefined> = process.env): {
  baseUrl: string;
  apiKey: string;
} {
  const configuredUrl = uniqueConfigured(
    env,
    ["HASNA_CONVERSATIONS_API_URL", "CONVERSATIONS_API_URL"],
    "CONV_API_URL_MISSING",
    "CONV_API_URL_CONFLICT",
  );
  const apiKey = uniqueConfigured(
    env,
    ["HASNA_CONVERSATIONS_API_KEY", "CONVERSATIONS_API_KEY"],
    "CONV_API_KEY_MISSING",
    "CONV_API_KEY_CONFLICT",
  );
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("CONV_API_URL_INVALID");
  }
  const path = url.pathname.replace(/\/$/, "") || "/";
  const protocolAllowed = url.protocol === "https:" || (url.protocol === "http:" && loopback(url.hostname));
  if (
    !protocolAllowed
    || url.username
    || url.password
    || url.search
    || url.hash
    || (path !== "/" && path !== "/v1")
  ) {
    throw new Error("CONV_API_URL_INVALID");
  }
  return { baseUrl: url.origin, apiKey };
}

export function incidentPublisherRequiredLeaseMs(requestTimeoutMs: number): number {
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60_000) {
    throw new Error("INCIDENT_PUBLISH_TIMEOUT_INVALID");
  }
  return INCIDENT_PUBLISHER_MAX_REMOTE_WINDOWS * requestTimeoutMs + INCIDENT_PUBLISHER_LEASE_SAFETY_MS;
}

export function validateIncidentPublisherLeaseBudget(input: { leaseSeconds: number; requestTimeoutMs: number }): void {
  if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 1 || input.leaseSeconds > 3_600) {
    throw new Error("INCIDENT_PUBLISH_LEASE_BUDGET_INVALID");
  }
  if (input.leaseSeconds * 1_000 <= incidentPublisherRequiredLeaseMs(input.requestTimeoutMs)) {
    throw new Error("INCIDENT_PUBLISH_LEASE_BUDGET_INVALID");
  }
}

async function boundedCall<T>(
  timeoutMs: number,
  operation: (options: IncidentOutboxPublisherCallOptions) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(new OperationTimeoutError());
      reject(new OperationTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation({ signal: controller.signal }), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
}

function validStatus(value: unknown): value is IncidentOutboxStatus {
  const body = record(value);
  if (!body || !hasExactKeys(body, INCIDENT_OUTBOX_STATUS_KEYS)) return false;
  if (!["pending", "leased", "acked", "dead", "total"].every((key) => nonnegativeInteger(body[key]))) return false;
  return body.total === (body.pending as number) + (body.leased as number) + (body.acked as number) + (body.dead as number);
}

export async function inspectIncidentOutboxPublisher(input: {
  outbox: IncidentOutboxPublisherApi;
  requestTimeoutMs: number;
}): Promise<IncidentPublisherStatusResult> {
  incidentPublisherRequiredLeaseMs(input.requestTimeoutMs);
  try {
    const status = await boundedCall(input.requestTimeoutMs, (options) => input.outbox.status(options));
    if (!validStatus(status)) return { ok: false, outcome: "status_failed" };
    return { ok: true, outcome: "status", status };
  } catch {
    return { ok: false, outcome: "status_failed" };
  }
}

function validClaimedRecord(value: unknown, requiredRemainingMs: number, now: number): {
  ok: true;
  record: IncidentOutboxRecord;
  event: IncidentProjectionEvent;
} | { ok: false; insufficient: boolean } {
  const validated = validateIncidentOutboxContract(value);
  if (!validated || validated.record.status !== "leased" || !validOutboxState(validated.record)) {
    return { ok: false, insufficient: false };
  }
  const leaseExpiry = Date.parse(validated.record.lease_expires_at!);
  if (!Number.isFinite(leaseExpiry)) return { ok: false, insufficient: false };
  if (leaseExpiry - now <= requiredRemainingMs) return { ok: false, insufficient: leaseExpiry > now };
  return { ok: true, record: validated.record, event: validated.event };
}

function boundedWireString(value: unknown, max: number): value is string {
  return nonempty(value) && value.length <= max;
}

function nullableWireString(value: unknown, max: number): boolean {
  return value === null || boundedWireString(value, max);
}

function wireTimestamp(value: unknown): value is string {
  return boundedWireString(value, 64) && isCanonicalIncidentTimestamp(value);
}

function nullableWireTimestamp(value: unknown): boolean {
  return value === null || wireTimestamp(value);
}

function wireUuid(value: unknown): value is string {
  return boundedWireString(value, 36)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function wireStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 64
    && value.every((item) => boundedWireString(item, 256));
}

function validateIncidentOutboxContract(value: unknown): {
  record: IncidentOutboxRecord;
  event: IncidentProjectionEvent;
} | null {
  const candidate = record(value);
  if (!candidate || !hasExactKeys(candidate, INCIDENT_OUTBOX_KEYS)) return null;
  const payload = record(candidate.payload);
  const incident = record(payload?.incident);
  if (
    !["pending", "leased", "acked", "dead"].includes(String(candidate.status))
    || !boundedWireString(candidate.event_id, 128)
    || !boundedWireString(candidate.projection_key, 512)
    || !wireUuid(candidate.incident_id)
    || !positiveInteger(candidate.incident_version)
    || !nullableWireString(candidate.depends_on_event_id, 128)
    || !nonnegativeInteger(candidate.attempts)
    || !wireTimestamp(candidate.next_attempt_at)
    || !nullableWireString(candidate.lease_token, 256)
    || !nullableWireString(candidate.leased_by, 256)
    || !nullableWireTimestamp(candidate.lease_expires_at)
    || !nullableWireString(candidate.delivery_id, 256)
    || !nullableWireTimestamp(candidate.acked_at)
    || !nullableWireString(candidate.last_error, 4_000)
    || !(candidate.failure_code === null || (
      boundedWireString(candidate.failure_code, 64) && /^[A-Z][A-Z0-9_:-]{1,63}$/.test(candidate.failure_code)
    ))
    || !(candidate.failure_fingerprint === null || (
      boundedWireString(candidate.failure_fingerprint, 64) && /^[0-9a-f]{64}$/.test(candidate.failure_fingerprint)
    ))
    || !nonnegativeInteger(candidate.consecutive_failures)
    || !wireTimestamp(candidate.created_at)
    || !wireTimestamp(candidate.updated_at)
    || !payload
    || !hasExactKeys(payload, INCIDENT_PROJECTION_EVENT_KEYS)
    || payload.schema_version !== 1
    || payload.source !== "todos"
    || !boundedWireString(payload.event_id, 128)
    || !boundedWireString(payload.projection_key, 512)
    || !boundedWireString(payload.authority_id, 128)
    || !wireUuid(payload.incident_id)
    || !boundedWireString(payload.transition_id, 128)
    || !positiveInteger(payload.incident_version)
    || !wireTimestamp(payload.occurred_at)
    || !incident
    || !hasExactKeys(incident, INCIDENT_STATE_KEYS)
    || !wireUuid(incident.id)
    || incident.id !== payload.incident_id
    || incident.version !== payload.incident_version
    || !boundedWireString(incident.title, 200)
    || !(INCIDENT_SEVERITIES as readonly unknown[]).includes(incident.severity)
    || !(INCIDENT_STATUSES as readonly unknown[]).includes(incident.status)
    || !boundedWireString(incident.owner, 128)
    || !wireStringArray(incident.affected_scopes)
    || incident.affected_scopes.length === 0
    || !wireStringArray(incident.blocked_scopes)
    || !incident.blocked_scopes.every((scope) => (
      scope.length <= 128 && Object.values(INCIDENT_BLOCKED_SCOPE_PATTERNS).some((pattern) => pattern.test(scope))
    ))
    || !nullableWireString(incident.containment, 4_000)
    || !nullableWireString(incident.next_action, 4_000)
    || !nullableWireTimestamp(incident.deadline)
    || !wireStringArray(incident.closure_evidence)
    || !(incident.supersedes_id === null || wireUuid(incident.supersedes_id))
    || !(incident.superseded_by_id === null || wireUuid(incident.superseded_by_id))
    || !nullableWireTimestamp(incident.resolved_at)
    || !wireTimestamp(incident.created_at)
    || !wireTimestamp(incident.updated_at)
    || incident.updated_at !== payload.occurred_at
    || (incident.status === "resolved" && incident.blocked_scopes.length > 0)
    || ((incident.status === "contained" || incident.status === "monitoring") && !nonempty(incident.containment))
    || ((ACTIVE_INCIDENT_STATUSES as readonly string[]).includes(String(incident.status)) && (
      !nonempty(incident.next_action) || incident.resolved_at !== null || incident.superseded_by_id !== null
    ))
    || (incident.status === "resolved" && (
      incident.next_action !== null || incident.closure_evidence.length === 0 || !wireTimestamp(incident.resolved_at)
      || incident.superseded_by_id !== null
    ))
    || (incident.status === "superseded" && (
      incident.next_action !== null || !wireUuid(incident.superseded_by_id) || !wireTimestamp(incident.resolved_at)
    ))
    || (payload.incident_version === 1 && (incident.status === "resolved" || incident.status === "superseded"))
    || candidate.event_id !== payload.event_id
    || candidate.projection_key !== payload.projection_key
    || candidate.incident_id !== payload.incident_id
    || candidate.incident_version !== payload.incident_version
  ) return null;
  try {
    const authorityId = normalizeIncidentAuthorityId(payload.authority_id);
    if (
      payload.authority_id !== authorityId
      || payload.event_id !== incidentEventId(authorityId, payload.incident_id, payload.incident_version)
      || payload.transition_id !== incidentTransitionId(authorityId, payload.incident_id, payload.incident_version)
      || payload.projection_key !== `todos:incident:${authorityId}:${payload.incident_id}:v${payload.incident_version}`
    ) return null;
  } catch {
    return null;
  }
  return {
    record: candidate as unknown as IncidentOutboxRecord,
    event: payload as unknown as IncidentProjectionEvent,
  };
}

function failureClassAbsent(recordValue: IncidentOutboxRecord): boolean {
  return recordValue.failure_code === null
    && recordValue.failure_fingerprint === null
    && recordValue.consecutive_failures === 0;
}

function failureClassPresent(recordValue: IncidentOutboxRecord): boolean {
  return recordValue.failure_code !== null
    && recordValue.failure_fingerprint === stableIncidentFingerprint({
      failure_code: recordValue.failure_code,
    })
    && recordValue.consecutive_failures > 0;
}

function validOutboxState(recordValue: IncidentOutboxRecord): boolean {
  const noLease = recordValue.lease_token === null
    && recordValue.leased_by === null
    && recordValue.lease_expires_at === null;
  const noDelivery = recordValue.delivery_id === null && recordValue.acked_at === null;
  const resetFailure = recordValue.last_error === null && failureClassAbsent(recordValue);
  const failed = recordValue.last_error !== null && failureClassPresent(recordValue);
  switch (recordValue.status) {
    case "pending":
      return noLease && noDelivery && (
        (recordValue.attempts === 0 && resetFailure)
        || (recordValue.attempts > 0 && failed)
      );
    case "leased":
      return recordValue.attempts > 0
        && recordValue.lease_token !== null
        && recordValue.leased_by !== null
        && recordValue.lease_expires_at !== null
        && noDelivery
        && (resetFailure || failed);
    case "acked":
      return recordValue.attempts > 0
        && noLease
        && recordValue.delivery_id !== null
        && recordValue.acked_at !== null
        && recordValue.last_error === null
        && (failureClassAbsent(recordValue) || failureClassPresent(recordValue));
    case "dead":
      return recordValue.attempts > 0 && noLease && noDelivery && failed;
  }
}

function validOutboxWireRecord(
  value: unknown,
  allowedStatuses: readonly IncidentOutboxRecord["status"][],
): value is IncidentOutboxRecord {
  const validated = validateIncidentOutboxContract(value);
  return validated !== null
    && allowedStatuses.includes(validated.record.status)
    && validOutboxState(validated.record);
}

function validRequeuedOutboxRecord(value: unknown): value is IncidentOutboxRecord {
  return validOutboxWireRecord(value, ["pending"])
    && value.attempts === 0
    && value.last_error === null
    && failureClassAbsent(value);
}

function validFailedOutboxRecord(value: unknown): value is IncidentOutboxRecord {
  return validOutboxWireRecord(value, ["pending", "dead"])
    && value.attempts > 0
    && value.failure_code !== null
    && value.last_error === `Projection delivery failed: ${value.failure_code}`
    && failureClassPresent(value);
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("CONV_RESPONSE_INVALID");
  const length = response.headers.get("content-length");
  if (length !== null) {
    const parsed = Number(length);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > INCIDENT_PUBLISHER_RESPONSE_LIMIT_BYTES) {
      throw new Error("CONV_RESPONSE_INVALID");
    }
  }
  if (!response.body) throw new Error("CONV_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new OperationTimeoutError();
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > INCIDENT_PUBLISHER_RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        throw new Error("CONV_RESPONSE_INVALID");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("CONV_RESPONSE_INVALID");
  }
}

async function readOptionalErrorJson(response: Response, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = readBoundedJson(response, signal).catch(() => null);
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(1, Math.min(50, Math.floor(timeoutMs / 4))));
  });
  try {
    return await Promise.race([read, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function validateProjectionResponse(value: unknown, event: IncidentProjectionEvent, status: number): ProjectorSuccess {
  const envelope = record(value);
  const projection = record(envelope?.projection);
  const message = record(projection?.message);
  const expectedReplayed = status === 200;
  const expectedBlocking = (ACTIVE_INCIDENT_STATUSES as readonly string[]).includes(event.incident.status)
    && event.incident.blocked_scopes.length > 0;
  const expectedSupersedesTransition = event.incident_version > 1
    ? incidentTransitionId(event.authority_id, event.incident_id, event.incident_version - 1)
    : null;
  if (
    !projection
    || !positiveInteger(projection.id)
    || !positiveInteger(projection.message_id)
    || projection.replayed !== expectedReplayed
    || projection.event_id !== event.event_id
    || projection.projection_key !== event.projection_key
    || projection.schema_version !== 1
    || projection.source !== "todos"
    || !nonempty(projection.tenant_id)
    || projection.authority_id !== event.authority_id
    || projection.incident_id !== event.incident_id
    || projection.transition_id !== event.transition_id
    || projection.incident_version !== event.incident_version
    || projection.occurred_at !== event.occurred_at
    || projection.status !== event.incident.status
    || projection.severity !== event.incident.severity
    || projection.blocking !== expectedBlocking
    || projection.supersedes_transition_id !== expectedSupersedesTransition
    || projection.supersedes_incident_id !== event.incident.supersedes_id
    || projection.superseded_by_incident_id !== event.incident.superseded_by_id
    || projection.canonical_payload !== canonicalIncidentJson(event)
    || projection.payload_hash !== stableIncidentFingerprint(event)
    || typeof projection.created_at !== "string"
    || !isCanonicalIncidentTimestamp(projection.created_at)
    || !message
    || message.id !== projection.message_id
  ) throw new Error("CONV_RESPONSE_INVALID");
  return { ok: true, messageId: projection.message_id, replayed: expectedReplayed };
}

function stableHttpFailure(status: number, value: unknown): string {
  const body = record(value);
  if (status === 400 && body?.code === "INVALID_INCIDENT_PROJECTION") return "INVALID_INCIDENT_PROJECTION";
  if (status === 409 && body?.code === "INCIDENT_PROJECTION_CONFLICT") return "INCIDENT_PROJECTION_CONFLICT";
  return `CONV_HTTP_${status}`;
}

async function projectorAttempt(
  event: IncidentProjectionEvent,
  options: Pick<IncidentPublisherOptions, "projectorBaseUrl" | "projectorApiKey" | "requestTimeoutMs" | "fetchImpl">,
): Promise<ProjectorAttempt> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    return await boundedCall(options.requestTimeoutMs, async ({ signal }) => {
      let response: Response;
      try {
        response = await fetchImpl(`${options.projectorBaseUrl}/v1/incident-projections`, {
          method: "POST",
          redirect: "manual",
          signal,
          headers: {
            "content-type": "application/json",
            "accept": "application/json",
            "x-api-key": options.projectorApiKey,
          },
          body: canonicalIncidentJson(event),
        });
      } catch (error) {
        if (signal.aborted || error instanceof OperationTimeoutError) throw new OperationTimeoutError();
        return { ok: false, code: "CONV_TRANSPORT", ambiguous: true };
      }
      if (response.status !== 200 && response.status !== 201) {
        if (response.status >= 200 && response.status < 300) {
          try { await response.body?.cancel(); } catch { /* bounded best effort */ }
          return { ok: false, code: "CONV_RESPONSE_INVALID", ambiguous: false };
        }
        const body = response.status === 400 || response.status === 409
          ? await readOptionalErrorJson(response, signal, options.requestTimeoutMs)
          : null;
        return { ok: false, code: stableHttpFailure(response.status, body), ambiguous: false };
      }
      try {
        const body = await readBoundedJson(response, signal);
        return validateProjectionResponse(body, event, response.status);
      } catch (error) {
        if (error instanceof OperationTimeoutError) throw error;
        return { ok: false, code: "CONV_RESPONSE_INVALID", ambiguous: false };
      }
    });
  } catch (error) {
    if (error instanceof OperationTimeoutError) return { ok: false, code: "CONV_TIMEOUT", ambiguous: true };
    return { ok: false, code: "CONV_TRANSPORT", ambiguous: true };
  }
}

function validAck(value: unknown, eventId: string, deliveryId: string): boolean {
  const result = record(value);
  return Boolean(
    result
    && validOutboxWireRecord(result, ["acked"])
    && result.event_id === eventId
    && result.status === "acked"
    && result.delivery_id === deliveryId
    && result.lease_token === null
    && result.leased_by === null
    && result.lease_expires_at === null
    && nonempty(result.acked_at),
  );
}

function validFail(value: unknown, eventId: string, failureCode: string): boolean {
  const result = record(value);
  return Boolean(
    result
    && validFailedOutboxRecord(result)
    && result.event_id === eventId
    && (result.status === "pending" || result.status === "dead")
    && result.failure_code === failureCode
    && result.last_error === `Projection delivery failed: ${failureCode}`
    && result.lease_token === null
    && result.leased_by === null
    && result.lease_expires_at === null,
  );
}

class IncidentOutboxHttpError extends Error {
  constructor(public readonly code: string, public readonly status?: number) {
    super(code);
    this.name = "IncidentOutboxHttpError";
  }
}

function normalizeIncidentOutboxBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("TODOS_API_URL_INVALID");
  }
  const path = url.pathname.replace(/\/$/, "") || "/";
  const protocolAllowed = url.protocol === "https:" || (url.protocol === "http:" && loopback(url.hostname));
  if (
    !protocolAllowed || url.username || url.password || url.search || url.hash
    || (path !== "/" && path !== "/v1")
  ) throw new Error("TODOS_API_URL_INVALID");
  return `${url.origin}/v1`;
}

function strictStatusEnvelope(value: unknown): IncidentOutboxStatus {
  const envelope = record(value);
  if (
    !envelope
    || !hasExactKeys(envelope, INCIDENT_STATUS_ENVELOPE_KEYS)
    || !validStatus(envelope.status)
  ) throw new IncidentOutboxHttpError("TODOS_RESPONSE_INVALID");
  return envelope.status;
}

function strictOutboxListEnvelope(
  value: unknown,
  allowedStatuses: readonly IncidentOutboxRecord["status"][],
): IncidentOutboxRecord[] {
  const envelope = record(value);
  if (
    !envelope
    || !hasExactKeys(envelope, INCIDENT_OUTBOX_LIST_ENVELOPE_KEYS)
    || !Array.isArray(envelope.outbox)
    || !nonnegativeInteger(envelope.count)
    || envelope.count !== envelope.outbox.length
    || !envelope.outbox.every((item) => validOutboxWireRecord(item, allowedStatuses))
  ) throw new IncidentOutboxHttpError("TODOS_RESPONSE_INVALID");
  return envelope.outbox;
}

function strictOutboxEnvelope(
  value: unknown,
  allowedStatuses: readonly IncidentOutboxRecord["status"][],
  expected: {
    eventId?: string;
    deliveryId?: string;
  } = {},
): IncidentOutboxRecord {
  const envelope = record(value);
  if (
    !envelope
    || !hasExactKeys(envelope, INCIDENT_OUTBOX_ENVELOPE_KEYS)
    || !validOutboxWireRecord(envelope.outbox, allowedStatuses)
    || (expected.eventId !== undefined && envelope.outbox.event_id !== expected.eventId)
    || (expected.deliveryId !== undefined && envelope.outbox.delivery_id !== expected.deliveryId)
  ) {
    throw new IncidentOutboxHttpError("TODOS_RESPONSE_INVALID");
  }
  return envelope.outbox;
}

function strictRequeuedOutboxEnvelope(value: unknown, expectedEventId: string): IncidentOutboxRecord {
  const envelope = record(value);
  if (
    !envelope
    || !hasExactKeys(envelope, INCIDENT_OUTBOX_ENVELOPE_KEYS)
    || !validRequeuedOutboxRecord(envelope.outbox)
    || envelope.outbox.event_id !== expectedEventId
  ) throw new IncidentOutboxHttpError("TODOS_RESPONSE_INVALID");
  return envelope.outbox;
}

function strictFailedOutboxEnvelope(
  value: unknown,
  expected: { eventId: string; failureCode: string; failure: string },
): IncidentOutboxRecord {
  const envelope = record(value);
  if (
    !envelope
    || !hasExactKeys(envelope, INCIDENT_OUTBOX_ENVELOPE_KEYS)
    || !validFailedOutboxRecord(envelope.outbox)
    || envelope.outbox.event_id !== expected.eventId
    || envelope.outbox.failure_code !== expected.failureCode
    || envelope.outbox.failure_fingerprint !== stableIncidentFingerprint({ failure_code: expected.failureCode })
    || envelope.outbox.last_error !== expected.failure
  ) throw new IncidentOutboxHttpError("TODOS_RESPONSE_INVALID");
  return envelope.outbox;
}

export function createIncidentOutboxHttpApi(options: IncidentOutboxHttpApiOptions): IncidentOutboxOperatorApi {
  const baseUrl = normalizeIncidentOutboxBaseUrl(options.baseUrl);
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("TODOS_API_KEY_MISSING");
  const fetchImpl = options.fetchImpl ?? fetch;

  const request = async (
    method: "GET" | "POST",
    path: string,
    callOptions: IncidentOutboxPublisherCallOptions,
    body?: unknown,
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        redirect: "manual",
        signal: callOptions.signal,
        headers: {
          "accept": "application/json",
          "x-api-key": apiKey,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new IncidentOutboxHttpError(callOptions.signal.aborted ? "TODOS_TIMEOUT" : "TODOS_TRANSPORT");
    }
    if (response.status < 200 || response.status >= 300) {
      try { await response.body?.cancel(); } catch { /* bounded best effort */ }
      throw new IncidentOutboxHttpError(`TODOS_HTTP_${response.status}`, response.status);
    }
    try {
      return await readBoundedJson(response, callOptions.signal);
    } catch {
      throw new IncidentOutboxHttpError(callOptions.signal.aborted ? "TODOS_TIMEOUT" : "TODOS_RESPONSE_INVALID");
    }
  };

  return {
    async status(callOptions) {
      return strictStatusEnvelope(await request("GET", "/incidents/outbox/status", callOptions));
    },
    async claim(input, callOptions) {
      const values = strictOutboxListEnvelope(
        await request("POST", "/incidents/outbox/claim", callOptions, input),
        ["leased"],
      );
      if (values.length > 1) throw new IncidentOutboxHttpError("TODOS_RESPONSE_INVALID");
      return values;
    },
    async ack(eventId, input, callOptions) {
      return strictOutboxEnvelope(await request(
        "POST",
        `/incidents/outbox/${encodeURIComponent(eventId)}/ack`,
        callOptions,
        input,
      ), ["acked"], { eventId, deliveryId: input.delivery_id });
    },
    async fail(eventId, input, callOptions) {
      return strictFailedOutboxEnvelope(await request(
        "POST",
        `/incidents/outbox/${encodeURIComponent(eventId)}/fail`,
        callOptions,
        input,
      ), { eventId, failureCode: input.failure_code, failure: input.failure });
    },
    async listDead(input, callOptions) {
      const query = new URLSearchParams();
      if (input.limit !== undefined) query.set("limit", String(input.limit));
      if (input.before_created_at !== undefined) query.set("before_created_at", input.before_created_at);
      if (input.before_event_id !== undefined) query.set("before_event_id", input.before_event_id);
      const suffix = query.size ? `?${query.toString()}` : "";
      return strictOutboxListEnvelope(await request("GET", `/incidents/outbox${suffix}`, callOptions), ["dead"]);
    },
    async getDead(eventId, callOptions) {
      try {
        return strictOutboxEnvelope(await request(
          "GET",
          `/incidents/outbox/${encodeURIComponent(eventId)}`,
          callOptions,
        ), ["dead"], { eventId });
      } catch (error) {
        if (error instanceof IncidentOutboxHttpError && error.status === 404) return null;
        throw error;
      }
    },
    async requeue(eventId, input, callOptions) {
      return strictRequeuedOutboxEnvelope(await request(
        "POST",
        `/incidents/outbox/${encodeURIComponent(eventId)}/requeue`,
        callOptions,
        input,
      ), eventId);
    },
  };
}

export async function publishIncidentOutboxOnce(options: IncidentPublisherOptions): Promise<IncidentPublisherResult> {
  validateIncidentPublisherLeaseBudget(options);
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1_000) {
    throw new Error("INCIDENT_PUBLISH_LIMIT_INVALID");
  }
  const requiredRemainingMs = incidentPublisherRequiredLeaseMs(options.requestTimeoutMs);
  const now = options.now ?? Date.now;
  const result: IncidentPublisherResult = {
    ok: true,
    outcome: "complete",
    claimed: 0,
    acked: 0,
    failed: 0,
    events: [],
  };

  while (result.claimed < options.limit) {
    let claimedValue: unknown;
    try {
      claimedValue = await boundedCall(options.requestTimeoutMs, (callOptions) => options.outbox.claim({
        limit: 1,
        lease_seconds: options.leaseSeconds,
      }, callOptions));
    } catch {
      return { ...result, ok: false, outcome: "claim_failed" };
    }
    if (!Array.isArray(claimedValue) || claimedValue.length > 1) {
      return { ...result, ok: false, outcome: "claim_invalid" };
    }
    if (claimedValue.length === 0) return result;
    const claimed = validClaimedRecord(claimedValue[0], requiredRemainingMs, now());
    if (!claimed.ok) {
      return {
        ...result,
        ok: false,
        outcome: claimed.insufficient ? "lease_insufficient" : "claim_invalid",
        claimed: claimed.insufficient ? result.claimed + 1 : result.claimed,
      };
    }
    result.claimed += 1;
    const { record: outboxRecord, event } = claimed;
    let postAttempts = 1;
    let delivery = await projectorAttempt(event, options);
    if (!delivery.ok && delivery.ambiguous) {
      postAttempts += 1;
      delivery = await projectorAttempt(event, options);
    }
    if (!delivery.ok) {
      if (delivery.ambiguous) {
        result.ok = false;
        result.outcome = "delivery_pending";
        result.events.push({ event_id: event.event_id, status: "delivery_pending" });
        return result;
      }
      const failureCode = delivery.code;
      try {
        const failed = await boundedCall(options.requestTimeoutMs, (callOptions) => options.outbox.fail(event.event_id, {
          lease_token: outboxRecord.lease_token!,
          failure_code: failureCode,
          failure: `Projection delivery failed: ${failureCode}`,
        }, callOptions));
        if (!validFail(failed, event.event_id, failureCode)) throw new Error("FAIL_RESPONSE_INVALID");
      } catch {
        result.ok = false;
        result.outcome = "fail_pending";
        result.events.push({ event_id: event.event_id, status: "fail_pending", failure_code: failureCode });
        return result;
      }
      result.ok = false;
      result.outcome = "failed";
      result.failed += 1;
      result.events.push({ event_id: event.event_id, status: "failed", failure_code: failureCode });
      return result;
    }

    const firstDelivery = delivery;
    const deliveryId = String(firstDelivery.messageId);
    let acked = false;
    try {
      const ack = await boundedCall(options.requestTimeoutMs, (callOptions) => options.outbox.ack(event.event_id, {
        lease_token: outboxRecord.lease_token!,
        delivery_id: deliveryId,
      }, callOptions));
      acked = validAck(ack, event.event_id, deliveryId);
    } catch {
      acked = false;
    }
    let finalDelivery = firstDelivery;
    let canRetryAck = false;
    if (!acked && postAttempts < 2) {
      postAttempts += 1;
      const replay = await projectorAttempt(event, options);
      if (replay.ok && replay.replayed && replay.messageId === firstDelivery.messageId) {
        finalDelivery = replay;
        canRetryAck = true;
      }
    } else if (!acked && postAttempts === 2) {
      // The second exact POST response already proves the stable delivery ID;
      // repeating the idempotent ACK needs no third projector request.
      canRetryAck = true;
    }
    if (!acked && canRetryAck) {
      try {
        const ack = await boundedCall(options.requestTimeoutMs, (callOptions) => options.outbox.ack(event.event_id, {
          lease_token: outboxRecord.lease_token!,
          delivery_id: deliveryId,
        }, callOptions));
        acked = validAck(ack, event.event_id, deliveryId);
      } catch {
        acked = false;
      }
    }
    if (!acked) {
      result.ok = false;
      result.outcome = "ack_pending";
      result.events.push({ event_id: event.event_id, status: "ack_pending", message_id: firstDelivery.messageId });
      return result;
    }
    result.acked += 1;
    result.events.push({
      event_id: event.event_id,
      status: "acked",
      message_id: finalDelivery.messageId,
      replayed: finalDelivery.replayed,
    });
  }
  return result;
}
