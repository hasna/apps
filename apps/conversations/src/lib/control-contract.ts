import { createHash } from "node:crypto";

export const CONTROL_CONTRACT_VERSION = "hasna.control/v1" as const;
export const CONTROL_METADATA_KEY = "hasna.control" as const;
export const CONTROL_VALIDATOR_VERSION = "hasna.control/v1" as const;
export const MAX_CONTROL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_CONTROL_ARRAY_ITEMS = 32;

export const CONTROL_STATES = ["freeze", "unfreeze"] as const;
export const CONTROL_SURFACES = ["announcements", "incidents"] as const;
export const CONTROL_SCOPE_KINDS = [
  "tenant",
  "project",
  "repository",
  "machine",
  "resource",
] as const;

export type ControlStateV1 = (typeof CONTROL_STATES)[number];
export type ControlSurfaceV1 = (typeof CONTROL_SURFACES)[number];
export type ControlScopeKindV1 = (typeof CONTROL_SCOPE_KINDS)[number];

export interface ControlScopeV1 {
  kind: ControlScopeKindV1;
  ids: string[];
}

export interface ControlReferenceV1 {
  event_id: string;
  control_id: string;
  fingerprint: string;
}

export interface ControlEventV1 {
  version: typeof CONTROL_CONTRACT_VERSION;
  event_id: string;
  control_id: string;
  lifecycle_version: number;
  state: ControlStateV1;
  fingerprint: string;
  tenant: string;
  authority_domain: string;
  policy_version: string;
  publisher: string;
  surface: ControlSurfaceV1;
  scope: ControlScopeV1;
  affected_operations: string[];
  affected_resources: string[];
  issued_at: string;
  expires_at: string;
  unfreeze_of: ControlReferenceV1 | null;
}

export type ControlEventPayloadV1 = Omit<ControlEventV1, "event_id">;

export interface TrustedControlEnvelopeV1 {
  authenticated_principal: string;
  tenant: string;
  authority_domain: string;
  permitted_surface: ControlSurfaceV1;
  policy_version: string;
  server_time: string;
  blocking: boolean;
}

export type ControlValidationCode =
  | "no_control_metadata"
  | "malformed_control_metadata"
  | "unsupported_contract_version"
  | "invalid_trusted_envelope"
  | "unexpected_keys"
  | "invalid_field"
  | "invalid_event_id"
  | "invalid_control_id"
  | "invalid_lifecycle"
  | "invalid_scope"
  | "invalid_sorted_unique_array"
  | "invalid_timestamp"
  | "invalid_ttl"
  | "event_before_activation"
  | "event_from_future"
  | "event_expired_at_ingress"
  | "trusted_claim_mismatch"
  | "blocking_state_mismatch"
  | "invalid_unfreeze_reference"
  | "secret_shaped_value";

export interface ControlValidationDiagnostic {
  code: ControlValidationCode;
}

export type ControlValidationResult =
  | {
      status: "absent";
      diagnostics: ControlValidationDiagnostic[];
    }
  | {
      status: "invalid";
      diagnostics: ControlValidationDiagnostic[];
    }
  | {
      status: "valid";
      event: ControlEventV1;
      trusted_envelope: TrustedControlEnvelopeV1;
      canonical_event: string;
      canonical_payload: string;
      diagnostics: ControlValidationDiagnostic[];
    };

export interface ControlValidationContextV1 {
  trusted_envelope: TrustedControlEnvelopeV1;
  activation_timestamp: string;
}

const MAX_CONTROL_EVENT_BYTES = 16_384;
const MAX_CONTROL_STRING_LENGTH = 128;
const MAX_CANONICAL_DEPTH = 16;
const MAX_CANONICAL_NODES = 1_024;

const TOKEN_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]{0,127})$/;
const EVENT_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const EVENT_KEYS = [
  "version",
  "event_id",
  "control_id",
  "lifecycle_version",
  "state",
  "fingerprint",
  "tenant",
  "authority_domain",
  "policy_version",
  "publisher",
  "surface",
  "scope",
  "affected_operations",
  "affected_resources",
  "issued_at",
  "expires_at",
  "unfreeze_of",
] as const;

const PAYLOAD_KEYS = EVENT_KEYS.filter((key) => key !== "event_id");
const SCOPE_KEYS = ["kind", "ids"] as const;
const REFERENCE_KEYS = ["event_id", "control_id", "fingerprint"] as const;
const TRUSTED_ENVELOPE_KEYS = [
  "authenticated_principal",
  "tenant",
  "authority_domain",
  "permitted_surface",
  "policy_version",
  "server_time",
  "blocking",
] as const;
const VALIDATION_CONTEXT_KEYS = ["trusted_envelope", "activation_timestamp"] as const;

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bAIza[A-Za-z0-9_-]{30,}\b/,
  /(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*\S{8,}/i,
] as const;

function invalidCanonicalJson(): never {
  throw new TypeError("invalid canonical JSON value");
}

function snapshotCanonicalValue(value: unknown): unknown {
  let nodeCount = 0;
  const ancestors = new WeakSet<object>();

  function snapshot(node: unknown, depth: number): unknown {
    nodeCount += 1;
    if (depth > MAX_CANONICAL_DEPTH || nodeCount > MAX_CANONICAL_NODES) {
      return invalidCanonicalJson();
    }
    if (node === null || typeof node === "boolean" || typeof node === "string") return node;
    if (typeof node === "number") {
      if (!Number.isFinite(node)) return invalidCanonicalJson();
      return Object.is(node, -0) ? 0 : node;
    }
    if (typeof node !== "object") return invalidCanonicalJson();
    if (ancestors.has(node)) return invalidCanonicalJson();

    const prototype = Object.getPrototypeOf(node);
    const keys = Reflect.ownKeys(node);
    if (keys.length > MAX_CANONICAL_NODES + 1 || keys.some((key) => typeof key === "symbol")) {
      return invalidCanonicalJson();
    }
    ancestors.add(node);
    try {
      if (Array.isArray(node)) {
        if (prototype !== Array.prototype) return invalidCanonicalJson();
        const lengthDescriptor = Object.getOwnPropertyDescriptor(node, "length");
        if (
          !lengthDescriptor ||
          !("value" in lengthDescriptor) ||
          lengthDescriptor.enumerable ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0 ||
          lengthDescriptor.value > MAX_CANONICAL_NODES
        ) {
          return invalidCanonicalJson();
        }
        const length = lengthDescriptor.value as number;
        if (keys.length !== length + 1 || !keys.includes("length")) return invalidCanonicalJson();

        const result: unknown[] = [];
        for (let index = 0; index < length; index++) {
          const key = String(index);
          if (!keys.includes(key)) return invalidCanonicalJson();
          const descriptor = Object.getOwnPropertyDescriptor(node, key);
          if (!descriptor?.enumerable || !("value" in descriptor)) return invalidCanonicalJson();
          result.push(snapshot(descriptor.value, depth + 1));
        }
        return result;
      }

      if (prototype !== Object.prototype && prototype !== null) return invalidCanonicalJson();
      const result = Object.create(null) as Record<string, unknown>;
      for (const key of keys as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) return invalidCanonicalJson();
        result[key] = snapshot(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(node);
    }
  }

  return snapshot(value, 0);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasDataPropertiesOnly(value: Record<string, unknown>): boolean {
  const names = Object.getOwnPropertyNames(value);
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  return names.every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return Boolean(descriptor?.enumerable && "value" in descriptor);
  });
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value) || !hasDataPropertiesOnly(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readArrayValues(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) return null;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || !names.includes("length")) return null;
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) return null;
    items.push(descriptor.value);
  }
  return items;
}

export function canonicalJson(value: unknown): string {
  const stableValue = snapshotCanonicalValue(value);
  let nodeCount = 0;

  function visit(node: unknown, depth: number): string {
    nodeCount += 1;
    if (depth > MAX_CANONICAL_DEPTH || nodeCount > MAX_CANONICAL_NODES) {
      return invalidCanonicalJson();
    }

    if (node === null) return "null";
    if (typeof node === "boolean") return node ? "true" : "false";
    if (typeof node === "string") return JSON.stringify(node);
    if (typeof node === "number") {
      if (!Number.isFinite(node)) return invalidCanonicalJson();
      return JSON.stringify(Object.is(node, -0) ? 0 : node);
    }
    if (Array.isArray(node)) {
      const items = readArrayValues(node);
      if (!items || items.length > MAX_CANONICAL_NODES) return invalidCanonicalJson();
      return `[${items.map((item) => visit(item, depth + 1)).join(",")}]`;
    }
    if (!isPlainRecord(node) || !hasDataPropertiesOnly(node)) return invalidCanonicalJson();

    const keys = Object.keys(node).sort(compareCanonicalStrings);
    const entries = keys.map((key) => `${JSON.stringify(key)}:${visit(node[key], depth + 1)}`);
    return `{${entries.join(",")}}`;
  }

  const canonical = visit(stableValue, 0);
  if (Buffer.byteLength(canonical, "utf8") > MAX_CONTROL_EVENT_BYTES) return invalidCanonicalJson();
  return canonical;
}

function containsSecretShapedValue(value: unknown, depth = 0): boolean {
  if (depth > MAX_CANONICAL_DEPTH) return false;
  if (typeof value === "string") return SECRET_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) {
    const items = readArrayValues(value);
    return items ? items.some((item) => containsSecretShapedValue(item, depth + 1)) : false;
  }
  if (!isPlainRecord(value) || !hasDataPropertiesOnly(value)) return false;
  return Object.values(value).some((item) => containsSecretShapedValue(item, depth + 1));
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_CONTROL_STRING_LENGTH && TOKEN_PATTERN.test(value);
}

export function isControlTokenV1(value: unknown): value is string {
  return isToken(value);
}

function isEventId(value: unknown): value is string {
  return typeof value === "string" && EVENT_ID_PATTERN.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) return null;
  return timestamp;
}

export function controlTimestampMsV1(value: unknown): number | null {
  return parseTimestamp(value);
}

function isSortedUniqueTokenArray(value: unknown): value is string[] {
  const items = readArrayValues(value);
  if (!items || items.length === 0 || items.length > MAX_CONTROL_ARRAY_ITEMS) return false;
  let previous: string | undefined;
  for (const item of items) {
    if (!isToken(item)) return false;
    if (previous !== undefined && compareCanonicalStrings(previous, item) >= 0) return false;
    previous = item;
  }
  return true;
}

function validateScope(value: unknown): value is ControlScopeV1 {
  if (!hasExactKeys(value, SCOPE_KEYS)) return false;
  return (
    typeof value.kind === "string" &&
    CONTROL_SCOPE_KINDS.includes(value.kind as ControlScopeKindV1) &&
    isSortedUniqueTokenArray(value.ids)
  );
}

export function isControlScopeV1(value: unknown): value is ControlScopeV1 {
  return validateScope(value);
}

function validateReference(value: unknown): value is ControlReferenceV1 {
  if (!hasExactKeys(value, REFERENCE_KEYS)) return false;
  return isEventId(value.event_id) && isUuid(value.control_id) && isEventId(value.fingerprint);
}

function intrinsicPayloadError(value: unknown): ControlValidationCode | null {
  if (!hasExactKeys(value, PAYLOAD_KEYS)) return "unexpected_keys";
  if (containsSecretShapedValue(value)) return "secret_shaped_value";
  if (value.version !== CONTROL_CONTRACT_VERSION) return "unsupported_contract_version";
  if (!isUuid(value.control_id)) return "invalid_control_id";
  if (!isEventId(value.fingerprint)) return "invalid_field";
  if (!isToken(value.tenant) || !isToken(value.authority_domain) || !isToken(value.policy_version) || !isToken(value.publisher)) {
    return "invalid_field";
  }
  if (typeof value.surface !== "string" || !CONTROL_SURFACES.includes(value.surface as ControlSurfaceV1)) {
    return "invalid_field";
  }
  if (!isPlainRecord(value.scope)) return "invalid_scope";
  if (!hasExactKeys(value.scope, SCOPE_KEYS)) return "unexpected_keys";
  if (!validateScope(value.scope)) return "invalid_scope";
  if (!isSortedUniqueTokenArray(value.affected_operations) || !isSortedUniqueTokenArray(value.affected_resources)) {
    return "invalid_sorted_unique_array";
  }

  const issuedAt = parseTimestamp(value.issued_at);
  const expiresAt = parseTimestamp(value.expires_at);
  if (issuedAt === null || expiresAt === null) return "invalid_timestamp";
  const ttl = expiresAt - issuedAt;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_CONTROL_TTL_MS) return "invalid_ttl";

  if (value.state === "freeze") {
    if (value.lifecycle_version !== 1) return "invalid_lifecycle";
    if (value.unfreeze_of !== null) return "invalid_unfreeze_reference";
  } else if (value.state === "unfreeze") {
    if (value.lifecycle_version !== 2) return "invalid_lifecycle";
    if (!validateReference(value.unfreeze_of)) return "invalid_unfreeze_reference";
    if (value.unfreeze_of.control_id !== value.control_id || value.unfreeze_of.fingerprint !== value.fingerprint) {
      return "invalid_unfreeze_reference";
    }
  } else {
    return "invalid_lifecycle";
  }

  try {
    canonicalJson(value);
  } catch {
    return "malformed_control_metadata";
  }
  return null;
}

function eventPayload(event: ControlEventV1): ControlEventPayloadV1 {
  return {
    version: event.version,
    control_id: event.control_id,
    lifecycle_version: event.lifecycle_version,
    state: event.state,
    fingerprint: event.fingerprint,
    tenant: event.tenant,
    authority_domain: event.authority_domain,
    policy_version: event.policy_version,
    publisher: event.publisher,
    surface: event.surface,
    scope: event.scope,
    affected_operations: event.affected_operations,
    affected_resources: event.affected_resources,
    issued_at: event.issued_at,
    expires_at: event.expires_at,
    unfreeze_of: event.unfreeze_of,
  };
}

function safePayload(value: ControlEventPayloadV1): ControlEventPayloadV1 {
  const stableValue = snapshotCanonicalValue(value);
  const error = intrinsicPayloadError(stableValue);
  if (error) throw new TypeError(`invalid control event payload: ${error}`);
  return stableValue as ControlEventPayloadV1;
}

export function deriveControlEventId(payload: ControlEventPayloadV1): string {
  const canonical = canonicalJson(safePayload(payload));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function createControlEventV1(payload: ControlEventPayloadV1): ControlEventV1 {
  const validPayload = safePayload(payload);
  return {
    ...validPayload,
    event_id: deriveControlEventId(validPayload),
  };
}

export function controlMetadataV1(event: ControlEventV1): Record<string, unknown> {
  return { [CONTROL_METADATA_KEY]: event };
}

function validateControlMetadataV1Unsafe(
  metadata: unknown,
  context: ControlValidationContextV1,
): ControlValidationResult {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { status: "absent", diagnostics: [{ code: "no_control_metadata" }] };
  }
  const metadataPrototype = Object.getPrototypeOf(metadata);
  if (metadataPrototype !== Object.prototype && metadataPrototype !== null) {
    return { status: "absent", diagnostics: [{ code: "no_control_metadata" }] };
  }
  const descriptor = Object.getOwnPropertyDescriptor(metadata, CONTROL_METADATA_KEY);
  if (!descriptor) return { status: "absent", diagnostics: [{ code: "no_control_metadata" }] };
  if (!descriptor?.enumerable || !("value" in descriptor)) {
    return { status: "invalid", diagnostics: [{ code: "malformed_control_metadata" }] };
  }
  const candidate = snapshotCanonicalValue(descriptor.value);
  if (!isPlainRecord(candidate) || !hasDataPropertiesOnly(candidate)) {
    return { status: "invalid", diagnostics: [{ code: "malformed_control_metadata" }] };
  }
  if (typeof candidate.version === "string" && candidate.version !== CONTROL_CONTRACT_VERSION) {
    return { status: "invalid", diagnostics: [{ code: "unsupported_contract_version" }] };
  }
  if (!hasExactKeys(candidate, EVENT_KEYS)) {
    return { status: "invalid", diagnostics: [{ code: "unexpected_keys" }] };
  }
  if (containsSecretShapedValue(candidate)) {
    return { status: "invalid", diagnostics: [{ code: "secret_shaped_value" }] };
  }

  const stableContext = snapshotCanonicalValue(context);
  if (!hasExactKeys(stableContext, VALIDATION_CONTEXT_KEYS)) {
    return { status: "invalid", diagnostics: [{ code: "invalid_trusted_envelope" }] };
  }
  if (!hasExactKeys(stableContext.trusted_envelope, TRUSTED_ENVELOPE_KEYS)) {
    return { status: "invalid", diagnostics: [{ code: "invalid_trusted_envelope" }] };
  }
  const trusted = stableContext.trusted_envelope;
  if (containsSecretShapedValue(trusted)) {
    return { status: "invalid", diagnostics: [{ code: "secret_shaped_value" }] };
  }
  if (
    !isToken(trusted.authenticated_principal) ||
    !isToken(trusted.tenant) ||
    !isToken(trusted.authority_domain) ||
    !isToken(trusted.policy_version) ||
    typeof trusted.permitted_surface !== "string" ||
    !CONTROL_SURFACES.includes(trusted.permitted_surface as ControlSurfaceV1) ||
    typeof trusted.blocking !== "boolean" ||
    parseTimestamp(trusted.server_time) === null
  ) {
    return { status: "invalid", diagnostics: [{ code: "invalid_trusted_envelope" }] };
  }

  const payload = eventPayload(candidate as unknown as ControlEventV1);
  const intrinsicError = intrinsicPayloadError(payload);
  if (intrinsicError) return { status: "invalid", diagnostics: [{ code: intrinsicError }] };
  if (!isEventId(candidate.event_id)) {
    return { status: "invalid", diagnostics: [{ code: "invalid_event_id" }] };
  }

  const activationTime = parseTimestamp(stableContext.activation_timestamp);
  const issuedAt = parseTimestamp(candidate.issued_at)!;
  const expiresAt = parseTimestamp(candidate.expires_at)!;
  const serverTime = parseTimestamp(trusted.server_time)!;
  if (activationTime === null) {
    return { status: "invalid", diagnostics: [{ code: "invalid_timestamp" }] };
  }
  if (issuedAt < activationTime || serverTime < activationTime) {
    return { status: "invalid", diagnostics: [{ code: "event_before_activation" }] };
  }
  if (issuedAt > serverTime) {
    return { status: "invalid", diagnostics: [{ code: "event_from_future" }] };
  }
  if (expiresAt <= serverTime) {
    return { status: "invalid", diagnostics: [{ code: "event_expired_at_ingress" }] };
  }
  if (
    candidate.publisher !== trusted.authenticated_principal ||
    candidate.tenant !== trusted.tenant ||
    candidate.authority_domain !== trusted.authority_domain ||
    candidate.surface !== trusted.permitted_surface ||
    candidate.policy_version !== trusted.policy_version
  ) {
    return { status: "invalid", diagnostics: [{ code: "trusted_claim_mismatch" }] };
  }
  if ((candidate.state === "freeze") !== trusted.blocking) {
    return { status: "invalid", diagnostics: [{ code: "blocking_state_mismatch" }] };
  }
  if (deriveControlEventId(payload) !== candidate.event_id) {
    return { status: "invalid", diagnostics: [{ code: "invalid_event_id" }] };
  }

  const event: ControlEventV1 = {
    version: CONTROL_CONTRACT_VERSION,
    event_id: candidate.event_id as string,
    control_id: candidate.control_id as string,
    lifecycle_version: candidate.lifecycle_version as number,
    state: candidate.state as ControlStateV1,
    fingerprint: candidate.fingerprint as string,
    tenant: candidate.tenant as string,
    authority_domain: candidate.authority_domain as string,
    policy_version: candidate.policy_version as string,
    publisher: candidate.publisher as string,
    surface: candidate.surface as ControlSurfaceV1,
    scope: {
      kind: (candidate.scope as ControlScopeV1).kind,
      ids: [...(candidate.scope as ControlScopeV1).ids],
    },
    affected_operations: [...(candidate.affected_operations as string[])],
    affected_resources: [...(candidate.affected_resources as string[])],
    issued_at: candidate.issued_at as string,
    expires_at: candidate.expires_at as string,
    unfreeze_of:
      candidate.unfreeze_of === null
        ? null
        : {
            event_id: (candidate.unfreeze_of as ControlReferenceV1).event_id,
            control_id: (candidate.unfreeze_of as ControlReferenceV1).control_id,
            fingerprint: (candidate.unfreeze_of as ControlReferenceV1).fingerprint,
          },
  };
  const trustedEnvelope: TrustedControlEnvelopeV1 = {
    authenticated_principal: trusted.authenticated_principal as string,
    tenant: trusted.tenant as string,
    authority_domain: trusted.authority_domain as string,
    permitted_surface: trusted.permitted_surface as ControlSurfaceV1,
    policy_version: trusted.policy_version as string,
    server_time: trusted.server_time as string,
    blocking: trusted.blocking as boolean,
  };
  return {
    status: "valid",
    event,
    trusted_envelope: trustedEnvelope,
    canonical_event: canonicalJson(event),
    canonical_payload: canonicalJson(payload),
    diagnostics: [],
  };
}

export function validateControlMetadataV1(
  metadata: unknown,
  context: ControlValidationContextV1,
): ControlValidationResult {
  try {
    return validateControlMetadataV1Unsafe(metadata, context);
  } catch {
    return { status: "invalid", diagnostics: [{ code: "malformed_control_metadata" }] };
  }
}
