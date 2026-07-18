import { createHash } from "crypto";
import { normalizeChannelName } from "./channel-names.js";
import type {
  IncidentProjectionDisplay,
  IncidentProjectionRequestV1,
  IncidentProjectorContext,
  IncidentSeverity,
  IncidentSnapshotV1,
  IncidentStatus,
  Priority,
} from "../types.js";

export const INCIDENT_SCHEMA_VERSION = 1 as const;
export const INCIDENT_SOURCE = "todos" as const;
export const INCIDENT_STATUSES = ["open", "investigating", "contained", "monitoring", "resolved", "superseded"] as const;
export const ACTIVE_INCIDENT_STATUSES = ["open", "investigating", "contained", "monitoring"] as const;
export const INCIDENT_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTHORITY_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Frozen Todos v1 blocked-scope grammar. Keep byte-for-byte aligned with the producer. */
export const INCIDENT_BLOCKED_SCOPE_PATTERNS = {
  agent: /^agent:([A-Za-z0-9][A-Za-z0-9._@/-]{0,127})$/,
  channel: /^channel:([a-z0-9]+(?:-[a-z0-9]+)*)$/,
  project: /^project:([A-Za-z0-9][A-Za-z0-9_-]{0,119})$/,
} as const;

export type IncidentBlockedScope =
  | { kind: "agent"; value: string }
  | { kind: "channel"; value: string }
  | { kind: "project"; value: string };

const REQUEST_KEYS = [
  "schema_version", "source", "authority_id", "incident_id", "transition_id", "incident_version",
  "occurred_at", "event_id", "projection_key", "incident",
] as const;
const INCIDENT_KEYS = [
  "id", "title", "severity", "status", "owner", "affected_scopes", "blocked_scopes",
  "containment", "next_action", "deadline", "closure_evidence", "supersedes_id",
  "superseded_by_id", "resolved_at", "version", "created_at", "updated_at",
] as const;

export const RESERVED_INCIDENT_METADATA_KEYS = new Set([
  "canonical_incident_projection",
  "incident_projection",
  "incident_id",
  "incident_version",
  "transition_id",
  "event_id",
  "projection_key",
  "authority_id",
  "tenant_id",
]);

export class IncidentProjectionValidationError extends Error {
  readonly code = "INVALID_INCIDENT_PROJECTION";
  constructor(message: string) {
    super(message);
    this.name = "IncidentProjectionValidationError";
  }
}

export class IncidentProjectionConflictError extends Error {
  readonly code = "INCIDENT_PROJECTION_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "IncidentProjectionConflictError";
  }
}

export class IncidentProjectorConfigurationError extends Error {
  readonly code = "INCIDENT_PROJECTOR_CONFIGURATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "IncidentProjectorConfigurationError";
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function fail(message: string): never {
  throw new IncidentProjectionValidationError(message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length) fail(`${path} contains unsupported field(s): ${unknown.sort().join(", ")}`);
  const missing = allowed.filter((key) => !(key in value));
  if (missing.length) fail(`${path} is missing field(s): ${missing.join(", ")}`);
}

function boundedString(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) fail(`${path} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) fail(`${path} must be at most ${max} characters`);
  return normalized;
}

function nonempty(value: unknown, path: string): string {
  return boundedString(value, path, 4_000);
}

function nullableString(value: unknown, path: string, max = 4_000): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail(`${path} must be a string or null`);
  return value.trim() ? boundedString(value, path, max) : null;
}

function uuid(value: unknown, path: string): string {
  const id = nonempty(value, path).toLowerCase();
  if (!UUID.test(id)) fail(`${path} must be a UUID`);
  return id;
}

export function validateIncidentAuthorityId(value: unknown, path: string): string {
  const id = boundedString(value, path, 128);
  if (!AUTHORITY_ID.test(id)) {
    fail(`${path} must contain only letters, digits, dot, underscore, colon, or hyphen`);
  }
  return id;
}

export function validateIncidentProjectorBinding(
  tenantId: unknown,
  authority: unknown,
): { tenant_id: string; authority_id: string } {
  try {
    return {
      tenant_id: boundedString(tenantId, "context.tenant_id", 256),
      authority_id: validateIncidentAuthorityId(authority, "context.authority_id"),
    };
  } catch (error) {
    throw new IncidentProjectorConfigurationError((error as Error).message);
  }
}

export function parseIncidentBlockedScope(value: string, path = "incident.blocked_scopes"): IncidentBlockedScope {
  if (value.length > 128) fail(`${path} must be at most 128 characters`);
  const agent = INCIDENT_BLOCKED_SCOPE_PATTERNS.agent.exec(value);
  if (agent) return { kind: "agent", value: agent[1] };
  const channel = INCIDENT_BLOCKED_SCOPE_PATTERNS.channel.exec(value);
  if (channel) return { kind: "channel", value: channel[1] };
  const project = INCIDENT_BLOCKED_SCOPE_PATTERNS.project.exec(value);
  if (project) return { kind: "project", value: project[1] };
  fail(
    `${path} must use the frozen recipient grammar: agent:<agent-id>, ` +
    "channel:<normalized-channel-name>, or project:<project-id>",
  );
}

function nullableUuid(value: unknown, path: string): string | null {
  return value === null ? null : uuid(value, path);
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail(`${path} must be a positive integer`);
  return Number(value);
}

function timestamp(value: unknown, path: string): string {
  const raw = nonempty(value, path);
  if (!RFC3339.test(raw) || !Number.isFinite(Date.parse(raw))) fail(`${path} must be an RFC3339 timestamp`);
  return new Date(raw).toISOString();
}

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : timestamp(value, path);
}

function stringSet(value: unknown, path: string, nonemptyRequired = false): string[] {
  if (!Array.isArray(value)) fail(`${path} must be an array of strings`);
  if (value.length > 64) fail(`${path} must contain at most 64 items`);
  const normalized: string[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const text = boundedString(item, `${path}[${index}]`, 256);
    if (!seen.has(text)) {
      seen.add(text);
      normalized.push(text);
    }
  });
  if (nonemptyRequired && normalized.length === 0) fail(`${path} must contain at least one scope`);
  return normalized;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function canonicalJson(value: JsonValue): string {
  const canonicalize = (entry: JsonValue): JsonValue => {
    if (Array.isArray(entry)) return entry.map(canonicalize);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.keys(entry).sort().map((key) => [key, canonicalize(entry[key])]),
      ) as { [key: string]: JsonValue };
    }
    return entry;
  };
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function computeIncidentProjectionIds(
  authorityId: string,
  incidentId: string,
  incidentVersion: number,
): { event_id: string; transition_id: string; projection_key: string } {
  const authority = validateIncidentAuthorityId(authorityId, "context.authority_id");
  const id = uuid(incidentId, "incident_id");
  const version = positiveInteger(incidentVersion, "incident_version");
  const digest = sha256(canonicalJson([authority, id, version]));
  return {
    event_id: `iev_${digest.slice(0, 32)}`,
    transition_id: `itr_${digest.slice(0, 32)}`,
    projection_key: `todos:incident:${authority}:${id}:v${version}`,
  };
}

function validateSnapshot(raw: unknown): IncidentSnapshotV1 {
  const value = object(raw, "incident");
  exactKeys(value, INCIDENT_KEYS, "incident");
  const status = oneOf<IncidentStatus>(value.status, INCIDENT_STATUSES, "incident.status");
  const severity = oneOf<IncidentSeverity>(value.severity, INCIDENT_SEVERITIES, "incident.severity");
  const id = uuid(value.id, "incident.id");
  const affectedScopes = stringSet(value.affected_scopes, "incident.affected_scopes", true);
  const blockedScopes = stringSet(value.blocked_scopes, "incident.blocked_scopes");
  blockedScopes.forEach((scope, index) => parseIncidentBlockedScope(scope, `incident.blocked_scopes[${index}]`));
  const supersedesId = nullableUuid(value.supersedes_id, "incident.supersedes_id");
  const supersededById = nullableUuid(value.superseded_by_id, "incident.superseded_by_id");
  const resolvedAt = nullableTimestamp(value.resolved_at, "incident.resolved_at");
  const createdAt = timestamp(value.created_at, "incident.created_at");
  const updatedAt = timestamp(value.updated_at, "incident.updated_at");

  if (Date.parse(updatedAt) < Date.parse(createdAt)) fail("incident.updated_at cannot precede incident.created_at");
  if (supersedesId === id || supersededById === id) fail("an incident cannot supersede itself");
  if ((status === "resolved" || status === "superseded") && !resolvedAt) {
    fail(`${status} incidents require incident.resolved_at`);
  }
  if (ACTIVE_INCIDENT_STATUSES.includes(status as (typeof ACTIVE_INCIDENT_STATUSES)[number]) && resolvedAt) {
    fail("active incidents cannot set incident.resolved_at");
  }
  if (status === "superseded" && !supersededById) fail("superseded incidents require incident.superseded_by_id");
  if (status !== "superseded" && supersededById) fail("only superseded incidents may set incident.superseded_by_id");
  const containment = nullableString(value.containment, "incident.containment");
  const nextAction = nullableString(value.next_action, "incident.next_action");
  const closureEvidence = stringSet(value.closure_evidence, "incident.closure_evidence");
  if ((status === "contained" || status === "monitoring") && !containment) {
    fail(`${status} incidents require incident.containment`);
  }
  if (ACTIVE_INCIDENT_STATUSES.includes(status as (typeof ACTIVE_INCIDENT_STATUSES)[number]) && !nextAction) {
    fail("active incidents require incident.next_action");
  }
  if (status === "resolved") {
    if (blockedScopes.length) fail("resolved incidents cannot retain incident.blocked_scopes");
    if (!closureEvidence.length) fail("resolved incidents require incident.closure_evidence");
    if (nextAction) fail("resolved incidents require incident.next_action to be null");
  }
  if (status === "superseded" && nextAction) {
    fail("superseded incidents require incident.next_action to be null");
  }

  return {
    id,
    title: boundedString(value.title, "incident.title", 200),
    severity,
    status,
    owner: boundedString(value.owner, "incident.owner", 128),
    affected_scopes: affectedScopes,
    blocked_scopes: blockedScopes,
    containment,
    next_action: nextAction,
    deadline: nullableTimestamp(value.deadline, "incident.deadline"),
    closure_evidence: closureEvidence,
    supersedes_id: supersedesId,
    superseded_by_id: supersededById,
    resolved_at: resolvedAt,
    version: positiveInteger(value.version, "incident.version"),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function buildIncidentProjectionDisplay(
  request: IncidentProjectionRequestV1,
  context: IncidentProjectorContext,
): IncidentProjectionDisplay {
  const routing = context.routing ?? {};
  const channel = normalizeChannelName(routing.channel?.trim() || "incidents");
  const from = routing.from?.trim() || "todos-projector";
  const to = routing.to?.trim() || channel;
  const incident = request.incident;
  const blockedLine = incident.status === "superseded"
    ? `Blocked scopes pending transfer: ${incident.blocked_scopes.length}`
    : `Blocked scopes: ${ACTIVE_INCIDENT_STATUSES.includes(incident.status as (typeof ACTIVE_INCIDENT_STATUSES)[number])
      ? incident.blocked_scopes.length
      : 0}`;
  const content = [
    `[INCIDENT ${incident.severity.toUpperCase()} ${incident.status.toUpperCase()}] ${incident.title}`,
    `Incident: ${incident.id} v${incident.version}`,
    `Owner: ${incident.owner}`,
    blockedLine,
    incident.status === "superseded" ? `Replacement incident: ${incident.superseded_by_id}` : null,
    incident.containment ? `Containment: ${incident.containment}` : null,
    incident.next_action ? `Next action: ${incident.next_action}` : null,
  ].filter(Boolean).join("\n");
  const priority: Priority = incident.severity === "critical" ? "urgent" : incident.severity === "high" ? "high" : "normal";
  return {
    from,
    to,
    content,
    channel,
    ...(routing.project_id?.trim() ? { project_id: routing.project_id.trim() } : {}),
    ...(routing.session_id?.trim() ? { session_id: routing.session_id.trim() } : {}),
    priority,
  };
}

export interface ValidatedIncidentProjection {
  context: IncidentProjectorContext;
  request: IncidentProjectionRequestV1;
  canonical_payload: string;
  payload_hash: string;
  blocking: boolean;
  supersedes_transition_id: string | null;
}

export function validateIncidentProjection(
  raw: unknown,
  rawContext: IncidentProjectorContext,
): ValidatedIncidentProjection {
  const context = {
    tenant_id: nonempty(rawContext?.tenant_id, "context.tenant_id"),
    authority_id: validateIncidentAuthorityId(rawContext?.authority_id, "context.authority_id"),
    routing: rawContext?.routing,
  };
  const value = object(raw, "projection");
  exactKeys(value, REQUEST_KEYS, "projection");
  if (value.schema_version !== INCIDENT_SCHEMA_VERSION) fail("projection.schema_version must be 1");
  if (value.source !== INCIDENT_SOURCE) fail("projection.source must be todos");
  const authorityId = validateIncidentAuthorityId(value.authority_id, "projection.authority_id");
  if (authorityId !== context.authority_id) fail("projection.authority_id does not match the selected Conversations authority");
  const incident = validateSnapshot(value.incident);
  const incidentId = uuid(value.incident_id, "projection.incident_id");
  const incidentVersion = positiveInteger(value.incident_version, "projection.incident_version");
  if (incident.id !== incidentId) fail("projection.incident_id must match incident.id");
  if (incident.version !== incidentVersion) fail("projection.incident_version must match incident.version");
  const ids = computeIncidentProjectionIds(context.authority_id, incidentId, incidentVersion);
  for (const key of ["event_id", "transition_id", "projection_key"] as const) {
    if (value[key] !== ids[key]) fail(`projection.${key} does not match the deterministic Todos v1 value`);
  }
  const occurredAt = timestamp(value.occurred_at, "projection.occurred_at");
  if (occurredAt !== incident.updated_at) {
    fail("projection.occurred_at must match incident.updated_at");
  }
  if (incidentVersion === 1) {
    if (!ACTIVE_INCIDENT_STATUSES.includes(incident.status as (typeof ACTIVE_INCIDENT_STATUSES)[number])) {
      fail("projection version 1 must contain an active incident state");
    }
    if (incident.created_at !== occurredAt) {
      fail("projection version 1 requires incident.created_at, incident.updated_at, and projection.occurred_at to match");
    }
  }
  const request: IncidentProjectionRequestV1 = {
    schema_version: INCIDENT_SCHEMA_VERSION,
    source: INCIDENT_SOURCE,
    authority_id: authorityId,
    incident_id: incidentId,
    transition_id: ids.transition_id,
    incident_version: incidentVersion,
    occurred_at: occurredAt,
    event_id: ids.event_id,
    projection_key: ids.projection_key,
    incident,
  };
  const canonicalPayload = canonicalJson(request as unknown as JsonValue);
  return {
    context,
    request,
    canonical_payload: canonicalPayload,
    payload_hash: sha256(canonicalPayload),
    blocking: ACTIVE_INCIDENT_STATUSES.includes(incident.status as (typeof ACTIVE_INCIDENT_STATUSES)[number]) && incident.blocked_scopes.length > 0,
    supersedes_transition_id: incidentVersion > 1
      ? computeIncidentProjectionIds(context.authority_id, incidentId, incidentVersion - 1).transition_id
      : null,
  };
}

export function metadataSpoofsIncidentProjection(raw: unknown): boolean {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return false; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).some((key) => RESERVED_INCIDENT_METADATA_KEYS.has(key));
}
