import { createHash } from "node:crypto";

export const INCIDENT_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export const INCIDENT_STATUSES = ["open", "investigating", "contained", "monitoring", "resolved", "superseded"] as const;
export const ACTIVE_INCIDENT_STATUSES = ["open", "investigating", "contained", "monitoring"] as const;

export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number];
export type IncidentStatus = typeof INCIDENT_STATUSES[number];

export interface IncidentState {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  owner: string;
  affected_scopes: string[];
  blocked_scopes: string[];
  containment: string | null;
  next_action: string | null;
  deadline: string | null;
  closure_evidence: string[];
  supersedes_id: string | null;
  superseded_by_id: string | null;
  resolved_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface NormalizedIncidentCreateInput {
  id: string;
  idempotency_key: string;
  title: string;
  severity: IncidentSeverity;
  status: typeof ACTIVE_INCIDENT_STATUSES[number];
  owner: string;
  affected_scopes: string[];
  blocked_scopes: string[];
  containment: string | null;
  next_action: string;
  deadline: string | null;
  closure_evidence: string[];
  supersedes_id: string | null;
  supersedes_expected_version: number | null;
}

export interface IncidentTransitionPatch {
  title?: string;
  severity?: IncidentSeverity;
  status?: Exclude<IncidentStatus, "superseded">;
  owner?: string;
  affected_scopes?: string[];
  blocked_scopes?: string[];
  containment?: string | null;
  next_action?: string | null;
  deadline?: string | null;
  closure_evidence?: string[];
}

export interface NormalizedIncidentTransitionInput {
  expected_version: number;
  idempotency_key: string;
  reason: string;
  patch: IncidentTransitionPatch;
}

export interface IncidentTransition {
  id: string;
  authority_id: string;
  incident_id: string;
  incident_version: number;
  idempotency_key: string;
  request_fingerprint: string;
  action: "created" | "updated" | "resolved" | "superseded";
  actor_id: string;
  effective_actor_id: string;
  actor_key_id: string | null;
  actor_act_as: boolean;
  reason: string;
  before: IncidentState | null;
  after: IncidentState;
  created_at: string;
}

export interface IncidentProjectionEvent {
  schema_version: 1;
  source: "todos";
  event_id: string;
  projection_key: string;
  authority_id: string;
  incident_id: string;
  transition_id: string;
  incident_version: number;
  occurred_at: string;
  incident: IncidentState;
}

export interface AppliedIncidentTransition {
  incident: IncidentState;
  transition: IncidentTransition;
}

export class IncidentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentValidationError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const INCIDENT_BLOCKED_SCOPE_PATTERNS = {
  agent: /^agent:[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$/,
  channel: /^channel:[a-z0-9]+(?:-[a-z0-9]+)*$/,
  project: /^project:[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/,
} as const;
export const INCIDENT_AUTHORITY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const RFC3339_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const CREATE_FIELDS = new Set([
  "id", "idempotency_key", "title", "severity", "status", "owner",
  "affected_scopes", "blocked_scopes", "containment", "next_action",
  "deadline", "closure_evidence", "supersedes_id", "supersedes_expected_version",
]);
const PATCH_FIELDS = [
  "title", "severity", "status", "owner", "affected_scopes", "blocked_scopes",
  "containment", "next_action", "deadline", "closure_evidence",
] as const;
const TRANSITION_FIELDS = new Set(["expected_version", "idempotency_key", "reason", ...PATCH_FIELDS]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IncidentValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(body: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(body).find((field) => !allowed.has(field));
  if (unknown) throw new IncidentValidationError(`unknown ${label} field: ${unknown}`);
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new IncidentValidationError(`${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > max) throw new IncidentValidationError(`${field} must be at most ${max} characters`);
  return normalized;
}

export function normalizeIncidentAuthorityId(value: unknown): string {
  const authorityId = boundedString(value, "authority_id", 128);
  if (!INCIDENT_AUTHORITY_ID_PATTERN.test(authorityId)) {
    throw new IncidentValidationError("authority_id must match ^[A-Za-z0-9._:-]{1,128}$");
  }
  return authorityId;
}

function nullableString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  return boundedString(value, field, max);
}

function stringArray(value: unknown, field: string, options: { required?: boolean } = {}): string[] {
  if (!Array.isArray(value)) throw new IncidentValidationError(`${field} must be an array of strings`);
  if (value.length > 64) throw new IncidentValidationError(`${field} must contain at most 64 items`);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = boundedString(item, `${field} item`, 256);
    if (!seen.has(text)) {
      seen.add(text);
      normalized.push(text);
    }
  }
  if (options.required && normalized.length === 0) {
    throw new IncidentValidationError(`${field} must contain at least one item`);
  }
  return normalized;
}

function blockedScopeArray(value: unknown): string[] {
  const scopes = stringArray(value, "blocked_scopes");
  for (const scope of scopes) {
    if (scope.length <= 128 && Object.values(INCIDENT_BLOCKED_SCOPE_PATTERNS).some((pattern) => pattern.test(scope))) continue;
    throw new IncidentValidationError(
      "blocked_scopes items must be agent:<agent-id>, channel:<normalized-channel-name>, or project:<project-id>",
    );
  }
  return scopes;
}

function incidentId(value: unknown, field: string): string {
  const id = boundedString(value, field, 36);
  if (!UUID_RE.test(id)) throw new IncidentValidationError(`${field} must be a UUID`);
  return id.toLowerCase();
}

function idempotencyKey(value: unknown): string {
  const key = boundedString(value, "idempotency_key", 128);
  if (key.length < 8 || !IDEMPOTENCY_KEY_RE.test(key)) {
    throw new IncidentValidationError("idempotency_key must be 8-128 URL-safe characters");
  }
  return key;
}

function positiveVersion(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new IncidentValidationError(`${field} must be a positive integer`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !isValidIncidentTimestamp(value)) {
    throw new IncidentValidationError(`${field} must be an RFC3339 timestamp or null`);
  }
  return new Date(value).toISOString();
}

export function isValidIncidentTimestamp(value: string): boolean {
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return false;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]! && Number.isFinite(Date.parse(value));
}

export function isCanonicalIncidentTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && isValidIncidentTimestamp(value)
    && new Date(value).toISOString() === value;
}

function severity(value: unknown): IncidentSeverity {
  if (typeof value !== "string" || !(INCIDENT_SEVERITIES as readonly string[]).includes(value)) {
    throw new IncidentValidationError(`severity must be one of: ${INCIDENT_SEVERITIES.join(", ")}`);
  }
  return value as IncidentSeverity;
}

export function normalizeIncidentCreateInput(value: unknown): NormalizedIncidentCreateInput {
  const body = record(value, "incident create body");
  rejectUnknownFields(body, CREATE_FIELDS, "incident create");
  const id = incidentId(body.id, "id");
  const status = body.status === undefined ? "open" : body.status;
  if (typeof status !== "string" || !(ACTIVE_INCIDENT_STATUSES as readonly string[]).includes(status)) {
    throw new IncidentValidationError(`status must be one of: ${ACTIVE_INCIDENT_STATUSES.join(", ")}`);
  }
  const containment = nullableString(body.containment, "containment", 4_000);
  if ((status === "contained" || status === "monitoring") && !containment) {
    throw new IncidentValidationError(`${status} incidents require containment`);
  }
  const supersedesId = body.supersedes_id === undefined || body.supersedes_id === null
    ? null
    : incidentId(body.supersedes_id, "supersedes_id");
  const supersedesExpectedVersion = body.supersedes_expected_version === undefined || body.supersedes_expected_version === null
    ? null
    : positiveVersion(body.supersedes_expected_version, "supersedes_expected_version");
  if ((supersedesId === null) !== (supersedesExpectedVersion === null)) {
    throw new IncidentValidationError("supersedes_id and supersedes_expected_version must be provided together");
  }
  if (supersedesId === id) throw new IncidentValidationError("an incident cannot supersede itself");
  return {
    id,
    idempotency_key: idempotencyKey(body.idempotency_key),
    title: boundedString(body.title, "title", 200),
    severity: severity(body.severity),
    status: status as NormalizedIncidentCreateInput["status"],
    owner: boundedString(body.owner, "owner", 128),
    affected_scopes: stringArray(body.affected_scopes, "affected_scopes", { required: true }),
    blocked_scopes: blockedScopeArray(body.blocked_scopes ?? []),
    containment,
    next_action: boundedString(body.next_action, "next_action", 4_000),
    deadline: timestamp(body.deadline, "deadline"),
    closure_evidence: stringArray(body.closure_evidence ?? [], "closure_evidence"),
    supersedes_id: supersedesId,
    supersedes_expected_version: supersedesExpectedVersion,
  };
}

export function normalizeIncidentTransitionInput(value: unknown): NormalizedIncidentTransitionInput {
  const body = record(value, "incident transition body");
  rejectUnknownFields(body, TRANSITION_FIELDS, "incident transition");
  const patch: IncidentTransitionPatch = {};
  if (body.title !== undefined) patch.title = boundedString(body.title, "title", 200);
  if (body.severity !== undefined) patch.severity = severity(body.severity);
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || body.status === "superseded" || !(INCIDENT_STATUSES as readonly string[]).includes(body.status)) {
      throw new IncidentValidationError("status must be open, investigating, contained, monitoring, or resolved");
    }
    patch.status = body.status as IncidentTransitionPatch["status"];
  }
  if (body.owner !== undefined) patch.owner = boundedString(body.owner, "owner", 128);
  if (body.affected_scopes !== undefined) patch.affected_scopes = stringArray(body.affected_scopes, "affected_scopes", { required: true });
  if (body.blocked_scopes !== undefined) patch.blocked_scopes = blockedScopeArray(body.blocked_scopes);
  if (body.containment !== undefined) patch.containment = nullableString(body.containment, "containment", 4_000);
  if (body.next_action !== undefined) patch.next_action = nullableString(body.next_action, "next_action", 4_000);
  if (body.deadline !== undefined) patch.deadline = timestamp(body.deadline, "deadline");
  if (body.closure_evidence !== undefined) patch.closure_evidence = stringArray(body.closure_evidence, "closure_evidence");
  if (Object.keys(patch).length === 0) throw new IncidentValidationError("incident transition patch must not be empty");
  return {
    expected_version: positiveVersion(body.expected_version, "expected_version"),
    idempotency_key: idempotencyKey(body.idempotency_key),
    reason: boundedString(body.reason, "reason", 2_000),
    patch,
  };
}

export function applyIncidentTransition(
  current: IncidentState,
  input: NormalizedIncidentTransitionInput,
  actorId: string,
  now: string,
  authorityId = "local-contract",
  actorKeyId: string | null = null,
  effectiveActorId = actorId,
  actorActAs = false,
): AppliedIncidentTransition {
  const authority = normalizeIncidentAuthorityId(authorityId);
  const actor = boundedString(actorId, "authenticated actor", 256);
  const effectiveActor = boundedString(effectiveActorId, "effective actor", 256);
  if (!isValidIncidentTimestamp(now)) throw new IncidentValidationError("transition time must be RFC3339");
  if (current.version !== input.expected_version) {
    throw new IncidentValidationError(`incident version conflict: expected ${input.expected_version}, current ${current.version}`);
  }
  if (current.status === "resolved" || current.status === "superseded") {
    throw new IncidentValidationError(`terminal incident ${current.id} cannot be changed`);
  }
  const next: IncidentState = {
    ...current,
    ...input.patch,
    version: current.version + 1,
    updated_at: new Date(now).toISOString(),
    resolved_at: null,
  };
  if (next.affected_scopes.length === 0) throw new IncidentValidationError("affected_scopes must not be empty");
  if (next.status === "contained" || next.status === "monitoring") {
    if (!next.containment) throw new IncidentValidationError(`${next.status} incidents require containment`);
  }
  if (next.status === "resolved") {
    if (next.blocked_scopes.length > 0) throw new IncidentValidationError("resolved incidents must not retain blocked_scopes");
    if (next.closure_evidence.length === 0) throw new IncidentValidationError("resolved incidents require closure_evidence");
    next.resolved_at = new Date(now).toISOString();
    next.next_action = null;
  } else if (!next.next_action) {
    throw new IncidentValidationError("active incidents require next_action");
  }
  const requestFingerprint = stableIncidentFingerprint({
    incident_id: current.id,
    expected_version: input.expected_version,
    idempotency_key: input.idempotency_key,
    reason: input.reason,
    patch: input.patch,
  });
  const action = next.status === "resolved" ? "resolved" : "updated";
  return {
    incident: next,
    transition: {
      id: incidentTransitionId(authority, current.id, next.version),
      authority_id: authority,
      incident_id: current.id,
      incident_version: next.version,
      idempotency_key: input.idempotency_key,
      request_fingerprint: requestFingerprint,
      action,
      actor_id: actor,
      effective_actor_id: effectiveActor,
      actor_key_id: actorKeyId,
      actor_act_as: actorActAs,
      reason: input.reason,
      before: { ...current },
      after: { ...next },
      created_at: new Date(now).toISOString(),
    },
  };
}

export function createInitialIncident(
  input: NormalizedIncidentCreateInput,
  authorityId: string,
  actorId: string,
  now: string,
  actorKeyId: string | null = null,
  effectiveActorId = actorId,
  actorActAs = false,
): AppliedIncidentTransition {
  const authority = normalizeIncidentAuthorityId(authorityId);
  const actor = boundedString(actorId, "authenticated actor", 256);
  const effectiveActor = boundedString(effectiveActorId, "effective actor", 256);
  if (!isValidIncidentTimestamp(now)) throw new IncidentValidationError("creation time must be RFC3339");
  const createdAt = new Date(now).toISOString();
  const incident: IncidentState = {
    id: input.id,
    title: input.title,
    severity: input.severity,
    status: input.status,
    owner: input.owner,
    affected_scopes: [...input.affected_scopes],
    blocked_scopes: [...input.blocked_scopes],
    containment: input.containment,
    next_action: input.next_action,
    deadline: input.deadline,
    closure_evidence: [...input.closure_evidence],
    supersedes_id: input.supersedes_id,
    superseded_by_id: null,
    resolved_at: null,
    version: 1,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const requestFingerprint = stableIncidentFingerprint(input);
  const transition: IncidentTransition = {
    id: incidentTransitionId(authority, incident.id, 1),
    authority_id: authority,
    incident_id: incident.id,
    incident_version: 1,
    idempotency_key: input.idempotency_key,
    request_fingerprint: requestFingerprint,
    action: "created",
    actor_id: actor,
    effective_actor_id: effectiveActor,
    actor_key_id: actorKeyId,
    actor_act_as: actorActAs,
    reason: "Incident created",
    before: null,
    after: { ...incident },
    created_at: createdAt,
  };
  return { incident, transition };
}

export function supersedeIncident(
  current: IncidentState,
  replacementIdValue: string,
  expectedVersion: number,
  authorityId: string,
  actorId: string,
  now: string,
  idempotencyKeyValue: string,
  actorKeyId: string | null = null,
  effectiveActorId = actorId,
  actorActAs = false,
): AppliedIncidentTransition {
  const replacementId = incidentId(replacementIdValue, "replacement incident id");
  if (replacementId === current.id) throw new IncidentValidationError("an incident cannot supersede itself");
  if (current.version !== positiveVersion(expectedVersion, "supersedes_expected_version")) {
    throw new IncidentValidationError(`incident version conflict: expected ${expectedVersion}, current ${current.version}`);
  }
  if (current.status === "resolved" || current.status === "superseded") {
    throw new IncidentValidationError(`terminal incident ${current.id} cannot be superseded`);
  }
  const authority = normalizeIncidentAuthorityId(authorityId);
  const actor = boundedString(actorId, "authenticated actor", 256);
  const effectiveActor = boundedString(effectiveActorId, "effective actor", 256);
  const key = idempotencyKey(idempotencyKeyValue);
  if (!isValidIncidentTimestamp(now)) throw new IncidentValidationError("supersession time must be RFC3339");
  const at = new Date(now).toISOString();
  const incident: IncidentState = {
    ...current,
    status: "superseded",
    superseded_by_id: replacementId,
    resolved_at: at,
    next_action: null,
    version: current.version + 1,
    updated_at: at,
  };
  const requestFingerprint = stableIncidentFingerprint({
    incident_id: current.id,
    replacement_id: replacementId,
    expected_version: expectedVersion,
    idempotency_key: key,
  });
  return {
    incident,
    transition: {
      id: incidentTransitionId(authority, current.id, incident.version),
      authority_id: authority,
      incident_id: current.id,
      incident_version: incident.version,
      idempotency_key: key,
      request_fingerprint: requestFingerprint,
      action: "superseded",
      actor_id: actor,
      effective_actor_id: effectiveActor,
      actor_key_id: actorKeyId,
      actor_act_as: actorActAs,
      reason: `Superseded by ${replacementId}`,
      before: { ...current },
      after: { ...incident },
      created_at: at,
    },
  };
}

export function stableIncidentFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function incidentTransitionId(authorityId: string, incidentIdValue: string, version: number): string {
  return `itr_${stableIncidentFingerprint([normalizeIncidentAuthorityId(authorityId), incidentIdValue, version]).slice(0, 32)}`;
}

export function incidentEventId(authorityId: string, incidentIdValue: string, version: number): string {
  return `iev_${stableIncidentFingerprint([normalizeIncidentAuthorityId(authorityId), incidentIdValue, version]).slice(0, 32)}`;
}

export function buildIncidentProjectionEvent(
  authorityId: string,
  transition: IncidentTransition,
): IncidentProjectionEvent {
  const authority = normalizeIncidentAuthorityId(authorityId);
  const eventId = incidentEventId(authority, transition.incident_id, transition.incident_version);
  const expectedTransitionId = incidentTransitionId(authority, transition.incident_id, transition.incident_version);
  if (transition.authority_id !== authority || transition.id !== expectedTransitionId) {
    throw new IncidentValidationError("transition authority or identity does not match the projection authority");
  }
  return {
    schema_version: 1,
    source: "todos",
    event_id: eventId,
    projection_key: `todos:incident:${authority}:${transition.incident_id}:v${transition.incident_version}`,
    authority_id: authority,
    incident_id: transition.incident_id,
    transition_id: transition.id,
    incident_version: transition.incident_version,
    occurred_at: transition.created_at,
    incident: { ...transition.after },
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
