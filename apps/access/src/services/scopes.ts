import { getDatabase, now, uuid } from "../db/database.js";
import { appendAuditEvent } from "../db/audit.js";
import { clampLimit, clampOffset } from "../db/crud.js";
import { entityScopeFilter, type AuthorizationContext } from "./authorization.js";
import { authorize } from "./authorization-scopes.js";
import { getIdentity } from "./identities.js";
import { ScopeNotFoundError, ValidationError, type Scope, type ScopeStatus } from "../types/index.js";

interface ScopeRow {
  id: string;
  identity_id: string;
  entity_id: string;
  scope: string;
  status: ScopeStatus;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

// MCP tool scope shape, e.g. "wallets:read", "secrets:write", "mcps:*".
const SCOPE_RE = /^[a-z][a-z0-9_-]*:(\*|[a-z][a-z0-9_*-]*)$/;

function toScope(row: ScopeRow): Scope {
  return { ...row };
}

export interface GrantScopeInput {
  identity_id: string;
  scope: string;
}

export function grantScope(input: GrantScopeInput, ctx?: AuthorizationContext): Scope {
  if (!input.scope || !SCOPE_RE.test(input.scope)) {
    throw new ValidationError("scope must be an MCP tool scope like 'wallets:read' or 'secrets:*'.");
  }
  const identity = getIdentity(input.identity_id, ctx);
  authorize("write", ctx, { entity_id: identity.entity_id, resource: "scope" });

  const db = getDatabase();
  const existing = db
    .query("SELECT * FROM scopes WHERE identity_id = ? AND scope = ? AND status = 'granted'")
    .get(identity.id, input.scope) as ScopeRow | null;
  if (existing) return toScope(existing);

  const id = uuid();
  const ts = now();
  db.query(
    `INSERT INTO scopes (id, identity_id, entity_id, scope, status, granted_by, granted_at, revoked_at, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, 'granted', ?, ?, NULL, ?, ?, 1)`,
  ).run(id, identity.id, identity.entity_id, input.scope, ctx?.actor_id ?? null, ts, ts, ts);
  appendAuditEvent(db, {
    entity_id: identity.entity_id,
    event_type: "scope.granted",
    actor: ctx?.actor_id ?? null,
    payload: { scope_id: id, identity_id: identity.id, scope: input.scope },
  });
  return getScope(id, ctx);
}

export function getScope(id: string, ctx?: AuthorizationContext): Scope {
  const db = getDatabase();
  const row = db.query("SELECT * FROM scopes WHERE id = ?").get(id) as ScopeRow | null;
  if (!row) throw new ScopeNotFoundError(id);
  authorize("read", ctx, { entity_id: row.entity_id, resource: "scope" });
  return toScope(row);
}

export interface ListScopesFilter {
  identity_id?: string;
  entity_id?: string;
  status?: ScopeStatus;
  limit?: number;
  offset?: number;
}

export function listScopes(filter: ListScopesFilter = {}, ctx?: AuthorizationContext): Scope[] {
  authorize("read", ctx, filter.entity_id ? { entity_id: filter.entity_id, resource: "scope" } : { resource: "scope" });
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
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  const scope = entityScopeFilter(ctx);
  if (scope) {
    clauses.push(scope.clause);
    params.push(...scope.params);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .query(`SELECT * FROM scopes ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, clampLimit(filter.limit), clampOffset(filter.offset)) as ScopeRow[];
  return rows.map(toScope);
}

export function revokeScope(id: string, reason: string, ctx?: AuthorizationContext): Scope {
  const db = getDatabase();
  const existing = getScope(id, ctx);
  authorize("revoke", ctx, { entity_id: existing.entity_id, resource: "scope" });
  db.query("UPDATE scopes SET status = 'revoked', revoked_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now(), now(), id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: "scope.revoked",
    actor: ctx?.actor_id ?? null,
    payload: { scope_id: id, scope: existing.scope, reason },
  });
  return getScope(id, ctx);
}

/** Effective granted scopes for an identity (permanent grants ∪ active JIT elevations). */
export function effectiveScopes(identityId: string, ctx?: AuthorizationContext): string[] {
  const identity = getIdentity(identityId, ctx);
  authorize("read", ctx, { entity_id: identity.entity_id, resource: "scope" });
  const db = getDatabase();
  const permanent = db.query("SELECT scope FROM scopes WHERE identity_id = ? AND status = 'granted'").all(identityId) as { scope: string }[];
  const nowTs = now();
  const elevated = db
    .query("SELECT scope FROM elevations WHERE identity_id = ? AND status = 'active' AND expires_at > ?")
    .all(identityId, nowTs) as { scope: string }[];
  return Array.from(new Set([...permanent.map((r) => r.scope), ...elevated.map((r) => r.scope)])).sort();
}
