import { appendAuditEvent } from "../db/audit.js";
import { clampLimit, clampOffset, parseJson } from "../db/crud.js";
import { getDatabase, now, uuid } from "../db/database.js";
import { entityScopeFilter, type AuthorizationContext } from "./authorization.js";
import { authorize } from "./authorization-scopes.js";
import { getIdentity } from "./identities.js";
import { assertNoRawSecretValues, validateSecretRef } from "./secret-boundary.js";
import {
  AccessRequestNotFoundError,
  InvalidTransitionError,
  ValidationError,
  VersionConflictError,
  type AccessRequest,
  type AccessRequestPolicyDecision,
  type AccessRequestStatus,
} from "../types/index.js";

interface AccessRequestRow {
  id: string;
  entity_id: string;
  requested_by_identity_id: string;
  provider: string;
  resource_kind: string;
  resource_ref: string;
  status: AccessRequestStatus;
  policy_mode: string;
  policy_decision: AccessRequestPolicyDecision;
  policy_reason: string | null;
  decision_metadata: string;
  approved_by: string | null;
  approved_at: string | null;
  secret_ref: string;
  command_preview: string;
  provision_metadata: string | null;
  provisioned_at: string | null;
  provisioned_by: string | null;
  failure_reason: string | null;
  failed_at: string | null;
  failed_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

const DEFAULT_POLICY_MODE = "permissive_default";
const DEFAULT_POLICY_DECISION: AccessRequestPolicyDecision = "allow";
const DEFAULT_POLICY_REASON = "Active agent provider-backed credential requests are allowed by the permissive default policy.";
const SLUG_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function toAccessRequest(row: AccessRequestRow): AccessRequest {
  return {
    ...row,
    decision_metadata: parseJson<Record<string, unknown>>(row.decision_metadata, {}),
    command_preview: parseJson<Record<string, unknown>>(row.command_preview, {}),
    provision_metadata: parseJson<Record<string, unknown> | null>(row.provision_metadata, null),
  };
}

function cleanSlug(value: string, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new ValidationError(`${label} is required.`);
  if (!SLUG_RE.test(trimmed)) {
    throw new ValidationError(`${label} must start with a letter or number and contain only letters, numbers, dot, underscore, colon, or hyphen.`);
  }
  return trimmed;
}

function cleanRef(value: string, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new ValidationError(`${label} is required.`);
  assertNoRawSecretValues(trimmed, label);
  return trimmed;
}

function cleanOptionalSecretRef(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return validateSecretRef(value);
}

function stringifyMetadata(value: Record<string, unknown> | null | undefined, fieldPath: string): string | null {
  if (value === undefined || value === null) return null;
  assertNoRawSecretValues(value, fieldPath);
  return JSON.stringify(value);
}

function assertExpectedVersion(expected: number | undefined, actual: number): void {
  if (expected !== undefined && expected !== actual) throw new VersionConflictError(expected, actual);
}

function assertStatus(existing: AccessRequest, allowed: AccessRequestStatus[], action: string): void {
  if (!allowed.includes(existing.status)) {
    throw new InvalidTransitionError(`Access request ${existing.id} is ${existing.status}; only ${allowed.join(", ")} requests can be ${action}.`);
  }
}

function buildSecretRef(entityId: string, provider: string, resourceKind: string, requestId: string): string {
  return `hasna/access/${entityId}/${provider}/${resourceKind}/${requestId}`;
}

function buildCommandPreview(input: {
  provider: string;
  resource_kind: string;
  resource_ref: string;
  secret_ref: string;
}): Record<string, unknown> {
  return {
    command: "provider.createCredential",
    args: {
      provider: input.provider,
      resource_kind: input.resource_kind,
      resource_ref: input.resource_ref,
      secret_ref: input.secret_ref,
    },
    redacted: true,
    stores_secret_material: false,
  };
}

export interface CreateAccessRequestInput {
  requested_by_identity_id: string;
  provider: string;
  resource_kind: string;
  resource_ref: string;
  decision_metadata?: Record<string, unknown> | null;
}

export function createAccessRequest(input: CreateAccessRequestInput, ctx?: AuthorizationContext): AccessRequest {
  const requester = getIdentity(input.requested_by_identity_id, ctx);
  if (requester.kind !== "agent" || requester.status !== "active") {
    throw new ValidationError("requested_by_identity_id must reference an active agent identity.");
  }
  authorize("read", ctx, { entity_id: requester.entity_id, resource: "access_request" });

  const provider = cleanSlug(input.provider, "provider");
  const resourceKind = cleanSlug(input.resource_kind, "resource_kind");
  const resourceRef = cleanRef(input.resource_ref, "resource_ref");
  assertNoRawSecretValues(input.decision_metadata, "decision_metadata");

  const db = getDatabase();
  const id = uuid();
  const ts = now();
  const secretRef = buildSecretRef(requester.entity_id, provider, resourceKind, id);
  const commandPreview = buildCommandPreview({ provider, resource_kind: resourceKind, resource_ref: resourceRef, secret_ref: secretRef });
  const decisionMetadata = {
    ...(input.decision_metadata ?? {}),
    policy_mode: DEFAULT_POLICY_MODE,
    policy_decision: DEFAULT_POLICY_DECISION,
    evaluated_at: ts,
    requested_by_identity_id: requester.id,
  };

  db.query(
    `INSERT INTO access_requests (
       id, entity_id, requested_by_identity_id, provider, resource_kind, resource_ref, status,
       policy_mode, policy_decision, policy_reason, decision_metadata, approved_by, approved_at,
       secret_ref, command_preview, provision_metadata, provisioned_at, provisioned_by,
       failure_reason, failed_at, failed_by, cancelled_at, cancelled_by, cancel_reason,
       created_at, updated_at, version
     )
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, 1)`,
  ).run(
    id,
    requester.entity_id,
    requester.id,
    provider,
    resourceKind,
    resourceRef,
    DEFAULT_POLICY_MODE,
    DEFAULT_POLICY_DECISION,
    DEFAULT_POLICY_REASON,
    JSON.stringify(decisionMetadata),
    secretRef,
    JSON.stringify(commandPreview),
    ts,
    ts,
  );
  appendAuditEvent(db, {
    entity_id: requester.entity_id,
    event_type: "access_request.created",
    actor: ctx?.actor_id ?? null,
    payload: {
      access_request_id: id,
      requested_by_identity_id: requester.id,
      provider,
      resource_kind: resourceKind,
      resource_ref: resourceRef,
      policy_mode: DEFAULT_POLICY_MODE,
      policy_decision: DEFAULT_POLICY_DECISION,
      secret_ref: secretRef,
    },
  });
  return getAccessRequest(id, ctx);
}

export function getAccessRequest(id: string, ctx?: AuthorizationContext): AccessRequest {
  const db = getDatabase();
  const row = db.query("SELECT * FROM access_requests WHERE id = ?").get(id) as AccessRequestRow | null;
  if (!row) throw new AccessRequestNotFoundError(id);
  authorize("read", ctx, { entity_id: row.entity_id, resource: "access_request" });
  return toAccessRequest(row);
}

export interface ListAccessRequestsFilter {
  entity_id?: string;
  requested_by_identity_id?: string;
  provider?: string;
  resource_kind?: string;
  resource_ref?: string;
  status?: AccessRequestStatus;
  policy_decision?: AccessRequestPolicyDecision;
  limit?: number;
  offset?: number;
}

export function listAccessRequests(filter: ListAccessRequestsFilter = {}, ctx?: AuthorizationContext): AccessRequest[] {
  authorize("read", ctx, filter.entity_id ? { entity_id: filter.entity_id, resource: "access_request" } : { resource: "access_request" });
  const db = getDatabase();
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter.entity_id) {
    clauses.push("entity_id = ?");
    params.push(filter.entity_id);
  }
  if (filter.requested_by_identity_id) {
    clauses.push("requested_by_identity_id = ?");
    params.push(filter.requested_by_identity_id);
  }
  if (filter.provider) {
    clauses.push("provider = ?");
    params.push(filter.provider);
  }
  if (filter.resource_kind) {
    clauses.push("resource_kind = ?");
    params.push(filter.resource_kind);
  }
  if (filter.resource_ref) {
    clauses.push("resource_ref = ?");
    params.push(filter.resource_ref);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter.policy_decision) {
    clauses.push("policy_decision = ?");
    params.push(filter.policy_decision);
  }
  const scope = entityScopeFilter(ctx);
  if (scope) {
    clauses.push(scope.clause);
    params.push(...scope.params);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .query(`SELECT * FROM access_requests ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, clampLimit(filter.limit), clampOffset(filter.offset)) as AccessRequestRow[];
  return rows.map(toAccessRequest);
}

export interface ApproveAccessRequestInput {
  approved_by?: string | null;
  policy_reason?: string | null;
  decision_metadata?: Record<string, unknown> | null;
  expected_version?: number;
}

export function approveAccessRequest(id: string, input: ApproveAccessRequestInput = {}, ctx?: AuthorizationContext): AccessRequest {
  const db = getDatabase();
  const existing = getAccessRequest(id, ctx);
  authorize("approve", ctx, { entity_id: existing.entity_id, resource: "access_request" });
  assertExpectedVersion(input.expected_version, existing.version);
  assertStatus(existing, ["pending"], "approved");
  assertNoRawSecretValues(input.decision_metadata, "decision_metadata");
  assertNoRawSecretValues(input.policy_reason, "policy_reason");

  const ts = now();
  const approvedBy = input.approved_by?.trim() || ctx?.actor_id || null;
  const decisionMetadata = {
    ...existing.decision_metadata,
    ...(input.decision_metadata ?? {}),
    policy_decision: DEFAULT_POLICY_DECISION,
    approved_at: ts,
    approved_by: approvedBy,
  };

  db.query(
    `UPDATE access_requests
     SET status = 'approved', policy_decision = 'allow', policy_reason = ?, decision_metadata = ?,
         approved_by = ?, approved_at = ?, updated_at = ?, version = version + 1
     WHERE id = ?`,
  ).run(input.policy_reason?.trim() || existing.policy_reason, JSON.stringify(decisionMetadata), approvedBy, ts, ts, id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: "access_request.approved",
    actor: ctx?.actor_id ?? null,
    payload: { access_request_id: id, approved_by: approvedBy, policy_decision: DEFAULT_POLICY_DECISION },
  });
  return getAccessRequest(id, ctx);
}

export interface MarkAccessRequestProvisionedInput {
  secret_ref?: string | null;
  provisioned_by?: string | null;
  provision_metadata?: Record<string, unknown> | null;
  expected_version?: number;
}

export function markAccessRequestProvisioned(
  id: string,
  input: MarkAccessRequestProvisionedInput = {},
  ctx?: AuthorizationContext,
): AccessRequest {
  const db = getDatabase();
  const existing = getAccessRequest(id, ctx);
  authorize("write", ctx, { entity_id: existing.entity_id, resource: "access_request" });
  assertExpectedVersion(input.expected_version, existing.version);
  assertStatus(existing, ["approved"], "marked provisioned");

  const ts = now();
  const secretRef = cleanOptionalSecretRef(input.secret_ref) ?? existing.secret_ref;
  const provisionedBy = input.provisioned_by?.trim() || ctx?.actor_id || null;
  const provisionMetadata = stringifyMetadata(input.provision_metadata, "provision_metadata");
  db.query(
    `UPDATE access_requests
     SET status = 'provisioned', secret_ref = ?, provision_metadata = ?, provisioned_at = ?, provisioned_by = ?,
         updated_at = ?, version = version + 1
     WHERE id = ?`,
  ).run(secretRef, provisionMetadata, ts, provisionedBy, ts, id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: "access_request.provisioned",
    actor: ctx?.actor_id ?? null,
    payload: { access_request_id: id, provider: existing.provider, resource_kind: existing.resource_kind, secret_ref: secretRef },
  });
  return getAccessRequest(id, ctx);
}

export interface FailAccessRequestInput {
  reason: string;
  failed_by?: string | null;
  provision_metadata?: Record<string, unknown> | null;
  expected_version?: number;
}

export function failAccessRequest(id: string, input: FailAccessRequestInput, ctx?: AuthorizationContext): AccessRequest {
  if (!input.reason?.trim()) throw new ValidationError("failure reason is required.");
  assertNoRawSecretValues(input.reason, "failure_reason");
  const db = getDatabase();
  const existing = getAccessRequest(id, ctx);
  authorize("write", ctx, { entity_id: existing.entity_id, resource: "access_request" });
  assertExpectedVersion(input.expected_version, existing.version);
  assertStatus(existing, ["pending", "approved"], "failed");

  const ts = now();
  const failedBy = input.failed_by?.trim() || ctx?.actor_id || null;
  const provisionMetadata = stringifyMetadata(input.provision_metadata, "provision_metadata");
  db.query(
    `UPDATE access_requests
     SET status = 'failed', failure_reason = ?, provision_metadata = COALESCE(?, provision_metadata),
         failed_at = ?, failed_by = ?, updated_at = ?, version = version + 1
     WHERE id = ?`,
  ).run(input.reason.trim(), provisionMetadata, ts, failedBy, ts, id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: "access_request.failed",
    actor: ctx?.actor_id ?? null,
    payload: { access_request_id: id, reason: input.reason.trim() },
  });
  return getAccessRequest(id, ctx);
}

export interface CancelAccessRequestInput {
  reason?: string | null;
  cancelled_by?: string | null;
  expected_version?: number;
}

export function cancelAccessRequest(id: string, input: CancelAccessRequestInput = {}, ctx?: AuthorizationContext): AccessRequest {
  assertNoRawSecretValues(input.reason, "cancel_reason");
  const db = getDatabase();
  const existing = getAccessRequest(id, ctx);
  authorize("write", ctx, { entity_id: existing.entity_id, resource: "access_request" });
  assertExpectedVersion(input.expected_version, existing.version);
  assertStatus(existing, ["pending", "approved"], "cancelled");

  const ts = now();
  const cancelledBy = input.cancelled_by?.trim() || ctx?.actor_id || null;
  const reason = input.reason?.trim() || null;
  db.query(
    `UPDATE access_requests
     SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?,
         updated_at = ?, version = version + 1
     WHERE id = ?`,
  ).run(ts, cancelledBy, reason, ts, id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: "access_request.cancelled",
    actor: ctx?.actor_id ?? null,
    payload: { access_request_id: id, reason },
  });
  return getAccessRequest(id, ctx);
}
