// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/intake/client.ts
import { createClientTransport } from "@hasna/contracts/client";

// src/intake/protocol.ts
import { createHash } from "crypto";

// src/redaction.ts
function shouldRedactKey(key) {
  return /secret|token|password|api[_-]?key|authorization/i.test(key);
}

// src/intake/protocol.ts
var INTAKE_PROTOCOL = "hasna.events.intake.v1";
var CANONICAL_ENCODING = "hasna.sorted-json.v1";
var MAX_ENVELOPE_BYTES = 256 * 1024;
var MAX_REQUEST_BYTES = MAX_ENVELOPE_BYTES * 2 + 8192;

class IntakeError extends Error {
  code;
  status;
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))
    throw new IntakeError("invalid_identity");
  return value;
}
var SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$(?![\s\S])/;
function sourceIdentity(value) {
  if (typeof value !== "string" || !SOURCE_ID_PATTERN.test(value))
    throw new IntakeError("invalid_source_identity");
  return value;
}
function boundedText(value, limit = 512) {
  if (typeof value !== "string" || !value.length || value.length > limit || /[\u0000-\u001f\u007f]/.test(value))
    throw new IntakeError("invalid_text");
  return value;
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new IntakeError("invalid_object");
  return value;
}
function exactKeys(value, required, optional = []) {
  if (required.some((k) => !Object.hasOwn(value, k)) || Object.keys(value).some((k) => !required.includes(k) && !optional.includes(k)))
    throw new IntakeError("invalid_fields");
}
function canonicalJson(input) {
  const seen = new Set;
  let nodes = 0;
  let scalarBytes = 0;
  function scalar(text) {
    scalarBytes += Buffer.byteLength(text);
    if (scalarBytes > MAX_ENVELOPE_BYTES)
      throw new IntakeError("envelope_too_large", 413);
    return text;
  }
  function encode(value, depth) {
    if (++nodes > 20000 || depth > 32)
      throw new IntakeError("envelope_complexity_exceeded");
    if (value === null || typeof value === "boolean")
      return scalar(JSON.stringify(value));
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new IntakeError("non_json_value");
      return scalar(JSON.stringify(value));
    }
    if (typeof value === "string") {
      if (Buffer.from(value, "utf8").toString("utf8") !== value)
        throw new IntakeError("invalid_unicode");
      return scalar(JSON.stringify(value));
    }
    if (!value || typeof value !== "object" || seen.has(value))
      throw new IntakeError("non_json_value");
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.keys(value).length !== value.length)
          throw new IntakeError("non_json_value");
        return `[${Array.from({ length: value.length }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !Object.hasOwn(descriptor, "value"))
            throw new IntakeError("non_json_value");
          return encode(descriptor.value, depth + 1);
        }).join(",")}]`;
      }
      const record = object(value);
      if (Reflect.ownKeys(record).length !== Object.keys(record).length)
        throw new IntakeError("non_json_value");
      return `{${Object.keys(record).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!Object.hasOwn(descriptor, "value") || ["__proto__", "constructor", "prototype"].includes(key))
          throw new IntakeError("non_json_value");
        return `${encode(key, depth + 1)}:${encode(descriptor.value, depth + 1)}`;
      }).join(",")}}`;
    } finally {
      seen.delete(value);
    }
  }
  const encoded = encode(input, 0);
  if (Buffer.byteLength(encoded) > MAX_ENVELOPE_BYTES)
    throw new IntakeError("envelope_too_large", 413);
  return encoded;
}
function envelopeHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function rejectSensitive(value) {
  if (typeof value === "string" && /(?:hasna_[a-z][a-z0-9-]*_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]{12,})/.test(value))
    throw new IntakeError("sensitive_envelope_rejected");
  if (Array.isArray(value)) {
    for (const item of value)
      rejectSensitive(item);
  } else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (shouldRedactKey(key) && item !== "[REDACTED]" && item !== null)
        throw new IntakeError("sensitive_envelope_rejected");
      rejectSensitive(item);
    }
}
function validateEnvelope(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_ENVELOPE_BYTES)
    throw new IntakeError("envelope_too_large", 413);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new IntakeError("invalid_envelope_json");
  }
  if (canonicalJson(parsed) !== text)
    throw new IntakeError("noncanonical_envelope");
  const e = object(parsed);
  exactKeys(e, ["id", "source", "type", "time", "severity", "data", "dedupeKey", "schemaVersion", "metadata"], ["subject", "message"]);
  boundedText(e.id);
  boundedText(e.dedupeKey);
  boundedText(e.source, 128);
  boundedText(e.type, 256);
  if (e.schemaVersion !== "1.0" || !["debug", "info", "notice", "warning", "error", "critical"].includes(String(e.severity)))
    throw new IntakeError("unsupported_envelope");
  if (typeof e.time !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.time) || !Number.isFinite(Date.parse(e.time)) || new Date(e.time).toISOString() !== e.time)
    throw new IntakeError("invalid_event_time");
  object(e.data);
  object(e.metadata);
  if (Object.hasOwn(e, "subject"))
    boundedText(e.subject, 1024);
  if (Object.hasOwn(e, "message"))
    boundedText(e.message, 4096);
  rejectSensitive(e);
  return e;
}
function validateBinding(raw) {
  const b = object(raw);
  return { sink_id: uuid(b.sink_id), producer_id: uuid(b.producer_id), corpus_id: sourceIdentity(b.corpus_id), source_authority_id: sourceIdentity(b.source_authority_id) };
}
function validateRequest(raw) {
  const r = object(raw);
  exactKeys(r, ["protocol", "encoding", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256", "envelope_json"]);
  validateBinding(r);
  if (r.protocol !== INTAKE_PROTOCOL || r.encoding !== CANONICAL_ENCODING)
    throw new IntakeError("unsupported_intake_protocol");
  const e = validateEnvelope(r.envelope_json);
  if (e.id !== r.event_id || e.dedupeKey !== r.dedupe_key || r.envelope_sha256 !== envelopeHash(r.envelope_json))
    throw new IntakeError("envelope_identity_or_hash_mismatch");
  return r;
}
function prepareIntake(binding, envelope) {
  const envelope_json = canonicalJson(envelope);
  return validateRequest({ ...validateBinding(binding), protocol: INTAKE_PROTOCOL, encoding: CANONICAL_ENCODING, event_id: envelope.id, dedupe_key: envelope.dedupeKey, envelope_sha256: envelopeHash(envelope_json), envelope_json });
}
function validateReceipt(raw, request, tenant) {
  const r = object(raw);
  exactKeys(r, ["protocol", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256", "tenant_id", "receipt_id", "accepted_at", "status"]);
  for (const k of ["protocol", "sink_id", "producer_id", "corpus_id", "source_authority_id", "event_id", "dedupe_key", "envelope_sha256"])
    if (r[k] !== request[k])
      throw new IntakeError("receipt_identity_mismatch", 502);
  uuid(r.receipt_id);
  if (r.tenant_id !== tenant || r.status !== "accepted_durable" || typeof r.accepted_at !== "string" || !Number.isFinite(Date.parse(r.accepted_at)))
    throw new IntakeError("unconfirmed_intake_receipt", 502);
  return r;
}

// src/intake/generated.ts
function acceptEvent(client, body, options) {
  return client.request("POST", "/intake/events", body, options);
}
function intakeCapability(client, options) {
  return client.request("GET", "/intake/capability", undefined, options);
}
function readReceipt(client, options) {
  return client.request("GET", "/intake/receipts", undefined, options);
}

// src/intake/client.ts
function createIntakeClient(options) {
  const binding = Object.freeze(validateBinding(options.binding));
  const tenant = boundedText(options.tenantId, 256);
  const { client, resolution } = createClientTransport("events", options.env ?? process.env, { credentials: options.credentials, retry: false, timeoutMs: 15000 });
  const headers = { "x-events-sink-id": binding.sink_id, "x-events-producer-id": binding.producer_id, "x-events-corpus-id": binding.corpus_id, "x-events-source-authority-id": binding.source_authority_id, "x-events-tenant-id": tenant };
  return Object.freeze({
    baseUrl: resolution.baseUrl,
    async capability() {
      const r = object(await intakeCapability(client, { headers, retry: false }));
      if (r.protocol !== INTAKE_PROTOCOL || r.tenant_id !== tenant || JSON.stringify(validateBinding(r)) !== JSON.stringify(binding) || typeof r.kid !== "string" || !r.kid)
        throw new IntakeError("intake_capability_mismatch", 502);
    },
    async accept(raw, signal) {
      const request = Object.freeze({ ...validateRequest(raw) });
      if (JSON.stringify(validateBinding(request)) !== JSON.stringify(binding))
        throw new IntakeError("client_binding_mismatch");
      const response = await acceptEvent(client, request, { headers, retry: false, signal });
      return validateReceipt(response, request, tenant);
    },
    async receipt(raw, signal) {
      const request = Object.freeze({ ...validateRequest(raw) });
      if (JSON.stringify(validateBinding(request)) !== JSON.stringify(binding))
        throw new IntakeError("client_binding_mismatch");
      const response = await readReceipt(client, { headers, query: { event_id: request.event_id }, retry: false, signal });
      return validateReceipt(response, request, tenant);
    }
  });
}
export {
  validateRequest,
  validateReceipt,
  validateEnvelope,
  validateBinding,
  uuid,
  sourceIdentity,
  prepareIntake,
  object,
  exactKeys,
  envelopeHash,
  createIntakeClient,
  canonicalJson,
  boundedText,
  SOURCE_ID_PATTERN,
  MAX_REQUEST_BYTES,
  MAX_ENVELOPE_BYTES,
  IntakeError,
  INTAKE_PROTOCOL,
  CANONICAL_ENCODING
};
