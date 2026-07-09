import { allowedEntityIds, type AuthorizationContext } from "./authorization.js";
import { authorize } from "./authorization-scopes.js";
import * as identities from "./identities.js";
import * as credentials from "./credentials.js";
import * as scopes from "./scopes.js";
import * as elevations from "./elevations.js";
import * as reviews from "./reviews.js";
import * as requests from "./access-requests.js";
import * as revocations from "./revocations.js";
import * as tokens from "./tokens.js";
import { listAuditEvents, verifyAuditChain } from "../db/audit.js";
import { getDatabase } from "../db/database.js";
import { ValidationError } from "../types/index.js";

/**
 * The canonical operation registry. CLI, MCP, and /v1 all dispatch through this
 * single table so interface parity holds by construction. The parity test
 * generates its op list from OPERATIONS rather than hand-listing them (§7).
 */

export type OpKind = "read" | "write";

export interface OperationInput {
  [key: string]: unknown;
}

export interface OperationDef {
  /** Canonical op id, e.g. "identity.create". */
  op: string;
  /** REST resource this op belongs to, e.g. "identities". */
  resource: string;
  kind: OpKind;
  /** Short summary for OpenAPI / help. */
  summary: string;
  handler: (input: OperationInput, ctx?: AuthorizationContext) => unknown;
}

function str(input: OperationInput, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || !v) throw new ValidationError(`Missing required field: ${key}`);
  return v;
}

function optStr(input: OperationInput, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v ? v : undefined;
}

function optNum(input: OperationInput, key: string): number | undefined {
  const v = input[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function optArr(input: OperationInput, key: string): string[] | undefined {
  const v = input[key];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return undefined;
}

function optObj(input: OperationInput, key: string): Record<string, unknown> | undefined {
  const v = input[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export const OPERATIONS: OperationDef[] = [
  // identities
  { op: "identity.create", resource: "identities", kind: "write", summary: "Register a non-human identity", handler: (i, c) => identities.createIdentity({ entity_id: str(i, "entity_id"), entity_slug: optStr(i, "entity_slug") ?? null, kind: str(i, "kind") as never, name: str(i, "name"), owner_ref: optStr(i, "owner_ref") ?? null, metadata: (i.metadata as Record<string, unknown>) ?? null }, c) },
  { op: "identity.get", resource: "identities", kind: "read", summary: "Get an identity by id", handler: (i, c) => identities.getIdentity(str(i, "id"), c) },
  { op: "identity.list", resource: "identities", kind: "read", summary: "List identities", handler: (i, c) => identities.listIdentities({ entity_id: optStr(i, "entity_id"), kind: optStr(i, "kind") as never, status: optStr(i, "status") as never, limit: optNum(i, "limit"), offset: optNum(i, "offset") }, c) },
  { op: "identity.update", resource: "identities", kind: "write", summary: "Update an identity", handler: (i, c) => identities.updateIdentity(str(i, "id"), { name: optStr(i, "name"), owner_ref: optStr(i, "owner_ref"), entity_slug: optStr(i, "entity_slug"), expected_version: optNum(i, "expected_version") }, c) },
  { op: "identity.suspend", resource: "identities", kind: "write", summary: "Suspend an identity", handler: (i, c) => identities.setIdentityStatus(str(i, "id"), "suspended", c) },
  { op: "identity.retire", resource: "identities", kind: "write", summary: "Retire an identity", handler: (i, c) => identities.setIdentityStatus(str(i, "id"), "retired", c) },

  // credentials
  { op: "credential.register", resource: "credentials", kind: "write", summary: "Register a credential reference (never a value)", handler: (i, c) => credentials.registerCredential({ identity_id: str(i, "identity_id"), name: str(i, "name"), kind: str(i, "kind") as never, secret_ref: str(i, "secret_ref") }, c) },
  { op: "credential.get", resource: "credentials", kind: "read", summary: "Get a credential by id", handler: (i, c) => credentials.getCredential(str(i, "id"), c) },
  { op: "credential.list", resource: "credentials", kind: "read", summary: "List credentials", handler: (i, c) => credentials.listCredentials({ identity_id: optStr(i, "identity_id"), entity_id: optStr(i, "entity_id"), status: optStr(i, "status") as never, limit: optNum(i, "limit"), offset: optNum(i, "offset") }, c) },
  { op: "credential.revoke", resource: "credentials", kind: "write", summary: "Revoke a credential", handler: (i, c) => credentials.revokeCredential(str(i, "id"), optStr(i, "reason") ?? "revoked", c) },

  // scopes
  { op: "scope.grant", resource: "scopes", kind: "write", summary: "Grant an MCP tool scope to an identity", handler: (i, c) => scopes.grantScope({ identity_id: str(i, "identity_id"), scope: str(i, "scope") }, c) },
  { op: "scope.get", resource: "scopes", kind: "read", summary: "Get a scope grant by id", handler: (i, c) => scopes.getScope(str(i, "id"), c) },
  { op: "scope.list", resource: "scopes", kind: "read", summary: "List scope grants", handler: (i, c) => scopes.listScopes({ identity_id: optStr(i, "identity_id"), entity_id: optStr(i, "entity_id"), status: optStr(i, "status") as never, limit: optNum(i, "limit"), offset: optNum(i, "offset") }, c) },
  { op: "scope.revoke", resource: "scopes", kind: "write", summary: "Revoke a scope grant", handler: (i, c) => scopes.revokeScope(str(i, "id"), optStr(i, "reason") ?? "revoked", c) },
  { op: "scope.effective", resource: "scopes", kind: "read", summary: "Effective scopes for an identity (grants + active elevations)", handler: (i, c) => ({ identity_id: str(i, "identity_id"), scopes: scopes.effectiveScopes(str(i, "identity_id"), c) }) },

  // elevations (JIT)
  { op: "elevation.request", resource: "elevations", kind: "write", summary: "Request a just-in-time elevation", handler: (i, c) => elevations.requestElevation({ identity_id: str(i, "identity_id"), scope: str(i, "scope"), reason: str(i, "reason"), ttl_minutes: optNum(i, "ttl_minutes"), expires_at: optStr(i, "expires_at") }, c) },
  { op: "elevation.approve", resource: "elevations", kind: "write", summary: "Approve a pending elevation", handler: (i, c) => elevations.approveElevation(str(i, "id"), str(i, "approver"), c) },
  { op: "elevation.get", resource: "elevations", kind: "read", summary: "Get an elevation by id", handler: (i, c) => elevations.getElevation(str(i, "id"), c) },
  { op: "elevation.list", resource: "elevations", kind: "read", summary: "List elevations", handler: (i, c) => elevations.listElevations({ identity_id: optStr(i, "identity_id"), entity_id: optStr(i, "entity_id"), status: optStr(i, "status") as never, limit: optNum(i, "limit"), offset: optNum(i, "offset") }, c) },
  { op: "elevation.revoke", resource: "elevations", kind: "write", summary: "Revoke an elevation", handler: (i, c) => elevations.revokeElevation(str(i, "id"), optStr(i, "reason") ?? "revoked", c) },
  { op: "elevation.expire", resource: "elevations", kind: "write", summary: "Sweep expired elevations", handler: (_i, c) => elevations.expireElevations(c) },

  // access reviews
  { op: "review.schedule", resource: "reviews", kind: "write", summary: "Schedule an access recertification review", handler: (i, c) => reviews.scheduleReview({ entity_id: str(i, "entity_id"), name: str(i, "name"), scheduled_at: optStr(i, "scheduled_at"), due_at: optStr(i, "due_at") ?? null, scope_filter: optStr(i, "scope_filter") ?? null }, c) },
  { op: "review.get", resource: "reviews", kind: "read", summary: "Get an access review by id", handler: (i, c) => reviews.getReview(str(i, "id"), c) },
  { op: "review.list", resource: "reviews", kind: "read", summary: "List access reviews", handler: (i, c) => reviews.listReviews({ entity_id: optStr(i, "entity_id"), status: optStr(i, "status") as never, limit: optNum(i, "limit"), offset: optNum(i, "offset") }, c) },
  { op: "review.start", resource: "reviews", kind: "write", summary: "Start an access review", handler: (i, c) => reviews.setReviewStatus(str(i, "id"), "in_progress", c) },
  { op: "review.complete", resource: "reviews", kind: "write", summary: "Complete an access review", handler: (i, c) => reviews.setReviewStatus(str(i, "id"), "completed", c, optStr(i, "completed_by")) },
  { op: "review.cancel", resource: "reviews", kind: "write", summary: "Cancel an access review", handler: (i, c) => reviews.setReviewStatus(str(i, "id"), "cancelled", c) },

  // access requests / provisioning
  { op: "request.create", resource: "requests", kind: "write", summary: "Create an access request", handler: (i, c) => requests.createAccessRequest({ requested_by_identity_id: optStr(i, "requested_by_identity_id") ?? str(i, "identity_id"), provider: str(i, "provider"), resource_kind: str(i, "resource_kind"), resource_ref: str(i, "resource_ref"), decision_metadata: optObj(i, "decision_metadata") ?? null }, c) },
  { op: "request.get", resource: "requests", kind: "read", summary: "Get an access request by id", handler: (i, c) => requests.getAccessRequest(str(i, "id"), c) },
  { op: "request.list", resource: "requests", kind: "read", summary: "List access requests", handler: (i, c) => requests.listAccessRequests({ requested_by_identity_id: optStr(i, "requested_by_identity_id") ?? optStr(i, "identity_id"), entity_id: optStr(i, "entity_id"), provider: optStr(i, "provider"), resource_kind: optStr(i, "resource_kind"), resource_ref: optStr(i, "resource_ref"), status: optStr(i, "status") as never, policy_decision: optStr(i, "policy_decision") as never, limit: optNum(i, "limit"), offset: optNum(i, "offset") }, c) },
  { op: "request.approve", resource: "requests", kind: "write", summary: "Approve an access request", handler: (i, c) => requests.approveAccessRequest(str(i, "id"), { approved_by: optStr(i, "approved_by") ?? optStr(i, "approver") ?? null, policy_reason: optStr(i, "policy_reason") ?? null, decision_metadata: optObj(i, "decision_metadata") ?? null, expected_version: optNum(i, "expected_version") }, c) },
  { op: "request.provision", resource: "requests", kind: "write", summary: "Mark an access request provisioned", handler: (i, c) => requests.markAccessRequestProvisioned(str(i, "id"), { provisioned_by: optStr(i, "provisioned_by") ?? optStr(i, "provisioner") ?? null, provision_metadata: optObj(i, "provision_metadata") ?? null, expected_version: optNum(i, "expected_version") }, c) },
  { op: "request.fail", resource: "requests", kind: "write", summary: "Mark an access request failed", handler: (i, c) => requests.failAccessRequest(str(i, "id"), { reason: str(i, "reason"), failed_by: optStr(i, "failed_by") ?? null, provision_metadata: optObj(i, "provision_metadata") ?? null, expected_version: optNum(i, "expected_version") }, c) },
  { op: "request.cancel", resource: "requests", kind: "write", summary: "Cancel an access request", handler: (i, c) => requests.cancelAccessRequest(str(i, "id"), { reason: optStr(i, "reason") ?? null, cancelled_by: optStr(i, "cancelled_by") ?? null, expected_version: optNum(i, "expected_version") }, c) },

  // revocations
  { op: "revocation.execute", resource: "revocations", kind: "write", summary: "One-click, audited revocation", handler: (i, c) => revocations.executeRevocation({ identity_id: str(i, "identity_id"), target_type: str(i, "target_type") as never, target_id: optStr(i, "target_id") ?? null, reason: str(i, "reason") }, c) },
  { op: "revocation.list", resource: "revocations", kind: "read", summary: "List revocations", handler: (i, c) => revocations.listRevocations({ identity_id: optStr(i, "identity_id"), entity_id: optStr(i, "entity_id"), limit: optNum(i, "limit"), offset: optNum(i, "offset") }, c) },

  // tokens (the MCP bearer-token issuer)
  { op: "token.issue", resource: "tokens", kind: "write", summary: "Issue an MCP bearer token", handler: (i, c) => tokens.issueToken({ identity_id: str(i, "identity_id"), scopes: optArr(i, "scopes"), entity_ids: optArr(i, "entity_ids"), credential_id: optStr(i, "credential_id") ?? null, ttl_minutes: optNum(i, "ttl_minutes") }, c) },
  { op: "token.verify", resource: "tokens", kind: "read", summary: "Verify an MCP bearer token", handler: (i) => tokens.verifyToken(str(i, "token")) },
  { op: "token.get", resource: "tokens", kind: "read", summary: "Get an issued token record by id", handler: (i, c) => tokens.getToken(str(i, "id"), c) },
  { op: "token.list", resource: "tokens", kind: "read", summary: "List issued tokens", handler: (i, c) => tokens.listTokens({ identity_id: optStr(i, "identity_id"), entity_id: optStr(i, "entity_id"), status: optStr(i, "status") as never, limit: optNum(i, "limit"), offset: optNum(i, "offset") }, c) },
  { op: "token.revoke", resource: "tokens", kind: "write", summary: "Revoke an issued token", handler: (i, c) => tokens.revokeToken(str(i, "id"), optStr(i, "reason") ?? "revoked", c) },

  // audit
  { op: "audit.list", resource: "audit", kind: "read", summary: "List append-only audit events", handler: (i, c) => { const entityId = optStr(i, "entity_id"); authorize("read", c, entityId ? { entity_id: entityId, resource: "audit" } : { resource: "audit" }); return listAuditEvents(getDatabase(), { entity_id: entityId, entity_ids: allowedEntityIds(c), limit: optNum(i, "limit") }); } },
  { op: "audit.verify", resource: "audit", kind: "read", summary: "Verify the audit hash chain", handler: (i, c) => { void i; authorize("read", c, { resource: "audit" }); return verifyAuditChain(getDatabase()); } },
];

const OP_INDEX = new Map(OPERATIONS.map((o) => [o.op, o]));

export function getOperation(op: string): OperationDef | undefined {
  return OP_INDEX.get(op);
}

export function runOperation(op: string, input: OperationInput, ctx?: AuthorizationContext): unknown {
  const def = OP_INDEX.get(op);
  if (!def) throw new Error(`Unknown operation: ${op}`);
  return def.handler(input, ctx);
}
