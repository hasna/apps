// PostgreSQL core extraction; legacy services remain only for unresolved compatibility surfaces.
import { getDatabase, now, uuid } from "../core-store.js";
import { appendAuditEvent } from "./audit.js";
import { clampLimit, clampOffset } from "../../db/crud.js";
import { entityScopeFilter, type AuthorizationContext } from "../../services/authorization.js";
import { authorize } from "../../services/authorization-scopes.js";
import { getIdentity, setIdentityStatus } from "./identities.js";
import { revokeCredential } from "./credentials.js";
import { revokeScope } from "./scopes.js";
import { revokeElevation } from "./elevations.js";
import { revokeToken } from "./tokens.js";
import { ValidationError, type Revocation, type RevocationTarget } from "../../types/index.js";

interface RevocationRow {
  id: string;
  identity_id: string;
  entity_id: string;
  target_type: RevocationTarget;
  target_id: string | null;
  reason: string;
  actor: string | null;
  created_at: string;
}

export interface ExecuteRevocationInput {
  identity_id: string;
  target_type: RevocationTarget;
  target_id?: string | null;
  reason: string;
}

export interface RevocationResult {
  revocation: Revocation;
  affected: number;
}

/**
 * One-click, audited revocation. Depending on target_type it revokes a single
 * credential/scope/elevation/token, or cascades across an identity (suspend +
 * revoke all its active credentials, scopes, elevations, and tokens).
 */
export async function executeRevocation(input: ExecuteRevocationInput, ctx?: AuthorizationContext): Promise<RevocationResult> {
  if (!input.reason?.trim()) throw new ValidationError("reason is required and audited for a revocation.");
  const identity = (await getIdentity(input.identity_id, ctx));
  authorize("revoke", ctx, { entity_id: identity.entity_id, resource: "revocation" });

  let affected = 0;
  switch (input.target_type) {
    case "credential":
      requireTargetId(input.target_id);
      (await revokeCredential(input.target_id!, input.reason, ctx));
      affected = 1;
      break;
    case "scope":
      requireTargetId(input.target_id);
      (await revokeScope(input.target_id!, input.reason, ctx));
      affected = 1;
      break;
    case "elevation":
      requireTargetId(input.target_id);
      (await revokeElevation(input.target_id!, input.reason, ctx));
      affected = 1;
      break;
    case "token":
      requireTargetId(input.target_id);
      (await revokeToken(input.target_id!, input.reason, ctx));
      affected = 1;
      break;
    case "identity":
      affected = (await cascadeIdentity(identity.id, input.reason, ctx));
      break;
    default:
      throw new ValidationError(`Unknown target_type: ${input.target_type}`);
  }

  const db = getDatabase();
  const id = uuid();
  (await db.query(
    `INSERT INTO revocations (id, identity_id, entity_id, target_type, target_id, reason, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, identity.id, identity.entity_id, input.target_type, input.target_id ?? null, input.reason.trim(), ctx?.actor_id ?? null, now()));
  (await appendAuditEvent(db, {
    entity_id: identity.entity_id,
    event_type: "revocation.executed",
    actor: ctx?.actor_id ?? null,
    payload: { revocation_id: id, target_type: input.target_type, target_id: input.target_id ?? null, affected, reason: input.reason.trim() },
  }));
  const revocation = (await db.query("SELECT * FROM revocations WHERE id = ?").get(id)) as RevocationRow;
  return { revocation: { ...revocation }, affected };
}

function requireTargetId(targetId?: string | null): void {
  if (!targetId) throw new ValidationError("target_id is required for a targeted revocation.");
}

async function cascadeIdentity(identityId: string, reason: string, ctx?: AuthorizationContext): Promise<number> {
  const db = getDatabase();
  let affected = 0;
  (await setIdentityStatus(identityId, "suspended", ctx));
  const creds = (await db.query("SELECT id FROM credentials WHERE identity_id = ? AND status = 'active'").all(identityId)) as { id: string }[];
  for (const c of creds) {
    (await revokeCredential(c.id, reason, ctx));
    affected += 1;
  }
  const scopes = (await db.query("SELECT id FROM scopes WHERE identity_id = ? AND status = 'granted'").all(identityId)) as { id: string }[];
  for (const s of scopes) {
    (await revokeScope(s.id, reason, ctx));
    affected += 1;
  }
  const elevations = (await db.query("SELECT id FROM elevations WHERE identity_id = ? AND status IN ('pending', 'active')").all(identityId)) as { id: string }[];
  for (const e of elevations) {
    (await revokeElevation(e.id, reason, ctx));
    affected += 1;
  }
  const tokens = (await db.query("SELECT id FROM issued_tokens WHERE identity_id = ? AND status = 'active'").all(identityId)) as { id: string }[];
  for (const t of tokens) {
    (await revokeToken(t.id, reason, ctx));
    affected += 1;
  }
  return affected;
}

export interface ListRevocationsFilter {
  identity_id?: string;
  entity_id?: string;
  limit?: number;
  offset?: number;
}

export async function listRevocations(filter: ListRevocationsFilter = {}, ctx?: AuthorizationContext): Promise<Revocation[]> {
  authorize("read", ctx, filter.entity_id ? { entity_id: filter.entity_id, resource: "revocation" } : { resource: "revocation" });
  const db = getDatabase();
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter.identity_id) {
    clauses.push("identity_id = ?");
    params.push(filter.identity_id);
  }
  if (filter.entity_id) {
    clauses.push("entity_id = ?");
    params.push(filter.entity_id);
  }
  const scope = entityScopeFilter(ctx);
  if (scope) {
    clauses.push(scope.clause);
    params.push(...scope.params);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (await db
    .query(`SELECT * FROM revocations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, clampLimit(filter.limit), clampOffset(filter.offset))) as RevocationRow[];
  return rows.map((r) => ({ ...r }));
}
