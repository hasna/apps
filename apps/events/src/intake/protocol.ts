import { createHash } from "node:crypto";
import type { EventEnvelope } from "../types.js";
import { shouldRedactKey } from "../redaction.js";

export const INTAKE_PROTOCOL = "hasna.events.intake.v1";
export const CANONICAL_ENCODING = "hasna.sorted-json.v1";
export const MAX_ENVELOPE_BYTES = 256 * 1024;
export const MAX_REQUEST_BYTES = MAX_ENVELOPE_BYTES * 2 + 8192;
export class IntakeError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)) throw new IntakeError("invalid_identity");
  return value;
}
export function boundedText(value: unknown, limit = 512): string {
  if (typeof value !== "string" || !value.length || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new IntakeError("invalid_text");
  return value;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new IntakeError("invalid_object");
  return value as Record<string, unknown>;
}
export function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new IntakeError("invalid_fields");
}

/** Versioned Hasna JSON encoding, not RFC 8785. No coercion, accessors or cycles. */
export function canonicalJson(input: unknown): string {
  const seen = new Set<object>();
  let nodes = 0;
  let scalarBytes = 0;
  function scalar(text: string): string {
    scalarBytes += Buffer.byteLength(text);
    if (scalarBytes > MAX_ENVELOPE_BYTES) throw new IntakeError("envelope_too_large", 413);
    return text;
  }
  function encode(value: unknown, depth: number): string {
    if (++nodes > 20_000 || depth > 32) throw new IntakeError("envelope_complexity_exceeded");
    if (value === null || typeof value === "boolean") return scalar(JSON.stringify(value));
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new IntakeError("non_json_value");
      return scalar(JSON.stringify(value));
    }
    if (typeof value === "string") {
      // Reject unpaired UTF-16 surrogates; hashing must represent valid UTF-8.
      if (Buffer.from(value, "utf8").toString("utf8") !== value) throw new IntakeError("invalid_unicode");
      return scalar(JSON.stringify(value));
    }
    if (!value || typeof value !== "object" || seen.has(value)) throw new IntakeError("non_json_value");
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length) throw new IntakeError("non_json_value");
        return `[${Array.from({ length: value.length }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new IntakeError("non_json_value");
          return encode(descriptor.value, depth + 1);
        }).join(",")}]`;
      }
      const record = object(value);
      if (Reflect.ownKeys(record).length !== Object.keys(record).length) throw new IntakeError("non_json_value");
      return `{${Object.keys(record).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
        if (!Object.hasOwn(descriptor, "value") || ["__proto__", "constructor", "prototype"].includes(key)) throw new IntakeError("non_json_value");
        return `${encode(key, depth + 1)}:${encode(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    } finally { seen.delete(value); }
  }
  const encoded = encode(input, 0);
  if (Buffer.byteLength(encoded) > MAX_ENVELOPE_BYTES) throw new IntakeError("envelope_too_large", 413);
  return encoded;
}
export function envelopeHash(text: string): string { return createHash("sha256").update(text, "utf8").digest("hex"); }

function rejectSensitive(value: unknown): void {
  if (typeof value === "string" && /(?:hasna_[a-z][a-z0-9-]*_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]{12,})/.test(value)) throw new IntakeError("sensitive_envelope_rejected");
  if (Array.isArray(value)) { for (const item of value) rejectSensitive(item); }
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (shouldRedactKey(key) && item !== "[REDACTED]" && item !== null) throw new IntakeError("sensitive_envelope_rejected");
    rejectSensitive(item);
  }
}

export function validateEnvelope(text: string): EventEnvelope {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_ENVELOPE_BYTES) throw new IntakeError("envelope_too_large", 413);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new IntakeError("invalid_envelope_json"); }
  if (canonicalJson(parsed) !== text) throw new IntakeError("noncanonical_envelope");
  const e = object(parsed);
  exactKeys(e, ["id", "source", "type", "time", "severity", "data", "dedupeKey", "schemaVersion", "metadata"], ["subject", "message"]);
  boundedText(e.id); boundedText(e.dedupeKey); boundedText(e.source, 128); boundedText(e.type, 256);
  if (e.schemaVersion !== "1.0" || !["debug", "info", "notice", "warning", "error", "critical"].includes(String(e.severity))) throw new IntakeError("unsupported_envelope");
  if (typeof e.time !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.time) || !Number.isFinite(Date.parse(e.time)) || new Date(e.time).toISOString() !== e.time) throw new IntakeError("invalid_event_time");
  object(e.data); object(e.metadata);
  if (Object.hasOwn(e, "subject")) boundedText(e.subject, 1024);
  if (Object.hasOwn(e, "message")) boundedText(e.message, 4096);
  // metadata.app_event is producer metadata, not the separate full AppEvent schema.
  rejectSensitive(e);
  return e as unknown as EventEnvelope;
}

export interface IntakeBinding {
  sink_id: string; producer_id: string; corpus_id: string; source_authority_id: string;
}
export interface IntakeRequest extends IntakeBinding {
  protocol: typeof INTAKE_PROTOCOL; encoding: typeof CANONICAL_ENCODING;
  event_id: string; dedupe_key: string; envelope_sha256: string; envelope_json: string;
}
export interface IntakeReceipt extends Omit<IntakeRequest, "envelope_json" | "encoding"> {
  tenant_id: string; receipt_id: string; accepted_at: string; status: "accepted_durable";
}
export function validateBinding(raw: unknown): IntakeBinding {
  const b = object(raw);
  return { sink_id: uuid(b.sink_id), producer_id: uuid(b.producer_id), corpus_id: uuid(b.corpus_id), source_authority_id: uuid(b.source_authority_id) };
}
export function validateRequest(raw: unknown): IntakeRequest {
  const r = object(raw);
  exactKeys(r, ["protocol", "encoding", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256", "envelope_json"]);
  validateBinding(r);
  if (r.protocol !== INTAKE_PROTOCOL || r.encoding !== CANONICAL_ENCODING) throw new IntakeError("unsupported_intake_protocol");
  const e = validateEnvelope(r.envelope_json as string);
  if (e.id !== r.event_id || e.dedupeKey !== r.dedupe_key || r.envelope_sha256 !== envelopeHash(r.envelope_json as string)) throw new IntakeError("envelope_identity_or_hash_mismatch");
  return r as unknown as IntakeRequest;
}
export function prepareIntake(binding: IntakeBinding, envelope: EventEnvelope): IntakeRequest {
  const envelope_json = canonicalJson(envelope);
  return validateRequest({ ...validateBinding(binding), protocol: INTAKE_PROTOCOL, encoding: CANONICAL_ENCODING, event_id: envelope.id, dedupe_key: envelope.dedupeKey, envelope_sha256: envelopeHash(envelope_json), envelope_json });
}
export function validateReceipt(raw: unknown, request: Omit<IntakeRequest, "envelope_json" | "encoding">, tenant: string): IntakeReceipt {
  const r = object(raw);
  exactKeys(r, ["protocol", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256", "tenant_id", "receipt_id", "accepted_at", "status"]);
  for (const k of ["protocol", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256"] as const) if (r[k] !== request[k]) throw new IntakeError("receipt_identity_mismatch", 502);
  uuid(r.receipt_id);
  if (r.tenant_id !== tenant || r.status !== "accepted_durable" || typeof r.accepted_at !== "string" || !Number.isFinite(Date.parse(r.accepted_at))) throw new IntakeError("unconfirmed_intake_receipt", 502);
  return r as unknown as IntakeReceipt;
}
