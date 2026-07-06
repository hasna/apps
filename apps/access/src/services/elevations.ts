import { getDatabase, now, uuid } from "../db/database.js";
import { appendAuditEvent } from "../db/audit.js";
import { clampLimit, clampOffset } from "../db/crud.js";
import { entityScopeFilter, type AuthorizationContext } from "./authorization.js";
import { authorize } from "./authorization-scopes.js";
import { getIdentity } from "./identities.js";
import {
  ElevationNotFoundError,
  InvalidTransitionError,
  ValidationError,
  type Elevation,
  type ElevationStatus,
} from "../types/index.js";

interface ElevationRow {
  id: string;
  identity_id: string;
  entity_id: string;
  scope: string;
  reason: string;
  approver: string | null;
  requested_by: string | null;
  expires_at: string;
  status: ElevationStatus;
  created_at: string;
  updated_at: string;
  version: number;
}

const DEFAULT_TTL_MINUTES = 60;

function toElevation(row: ElevationRow): Elevation {
  return { ...row };
}

export interface RequestElevationInput {
  identity_id: string;
  scope: string;
  reason: string;
  ttl_minutes?: number;
  expires_at?: string;
}

/** Request a JIT elevation. Created in 'active' state but not yet approver-signed. */
export function requestElevation(input: RequestElevationInput, ctx?: AuthorizationContext): Elevation {
  if (!input.scope?.trim()) throw new ValidationError("scope is required for an elevation.");
  if (!input.reason?.trim()) throw new ValidationError("reason is required for a JIT elevation (it is audited).");
  const identity = getIdentity(input.identity_id, ctx);
  authorize("write", ctx, { entity_id: identity.entity_id, resource: "elevation" });

  const expiresAt = input.expires_at ?? new Date(Date.now() + (input.ttl_minutes ?? DEFAULT_TTL_MINUTES) * 60_000).toISOString();
  if (Date.parse(expiresAt) <= Date.now()) throw new ValidationError("expires_at must be in the future.");

  const db = getDatabase();
  const id = uuid();
  const ts = now();
  db.query(
    `INSERT INTO elevations (id, identity_id, entity_id, scope, reason, approver, requested_by, expires_at, status, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'active', ?, ?, 1)`,
  ).run(id, identity.id, identity.entity_id, input.scope.trim(), input.reason.trim(), ctx?.actor_id ?? null, expiresAt, ts, ts);
  appendAuditEvent(db, {
    entity_id: identity.entity_id,
    event_type: "elevation.requested",
    actor: ctx?.actor_id ?? null,
    payload: { elevation_id: id, scope: input.scope.trim(), expires_at: expiresAt, reason: input.reason.trim() },
  });
  return getElevation(id, ctx);
}

export function approveElevation(id: string, approver: string, ctx?: AuthorizationContext): Elevation {
  const db = getDatabase();
  const existing = getElevation(id, ctx);
  authorize("approve", ctx, { entity_id: existing.entity_id, resource: "elevation" });
  if (existing.status !== "active") throw new InvalidTransitionError(`Elevation ${id} is ${existing.status}; only active elevations can be approved.`);
  if (!approver?.trim()) throw new ValidationError("approver is required.");
  db.query("UPDATE elevations SET approver = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(approver.trim(), now(), id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: "elevation.approved",
    actor: ctx?.actor_id ?? null,
    payload: { elevation_id: id, approver: approver.trim(), scope: existing.scope },
  });
  return getElevation(id, ctx);
}

export function getElevation(id: string, ctx?: AuthorizationContext): Elevation {
  const db = getDatabase();
  const row = db.query("SELECT * FROM elevations WHERE id = ?").get(id) as ElevationRow | null;
  if (!row) throw new ElevationNotFoundError(id);
  authorize("read", ctx, { entity_id: row.entity_id, resource: "elevation" });
  return toElevation(row);
}

export interface ListElevationsFilter {
  identity_id?: string;
  entity_id?: string;
  status?: ElevationStatus;
  limit?: number;
  offset?: number;
}

export function listElevations(filter: ListElevationsFilter = {}, ctx?: AuthorizationContext): Elevation[] {
  authorize("read", ctx, filter.entity_id ? { entity_id: filter.entity_id, resource: "elevation" } : { resource: "elevation" });
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
    .query(`SELECT * FROM elevations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, clampLimit(filter.limit), clampOffset(filter.offset)) as ElevationRow[];
  return rows.map(toElevation);
}

export function revokeElevation(id: string, reason: string, ctx?: AuthorizationContext): Elevation {
  const db = getDatabase();
  const existing = getElevation(id, ctx);
  authorize("revoke", ctx, { entity_id: existing.entity_id, resource: "elevation" });
  db.query("UPDATE elevations SET status = 'revoked', updated_at = ?, version = version + 1 WHERE id = ?").run(now(), id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: "elevation.revoked",
    actor: ctx?.actor_id ?? null,
    payload: { elevation_id: id, scope: existing.scope, reason },
  });
  return getElevation(id, ctx);
}

/** Sweep expired active elevations to 'expired'. Returns the count transitioned. */
export function expireElevations(ctx?: AuthorizationContext): { expired: number } {
  authorize("write", ctx, { resource: "elevation" });
  const db = getDatabase();
  const nowTs = now();
  const rows = db.query("SELECT id, entity_id, scope FROM elevations WHERE status = 'active' AND expires_at <= ?").all(nowTs) as {
    id: string;
    entity_id: string;
    scope: string;
  }[];
  for (const row of rows) {
    db.query("UPDATE elevations SET status = 'expired', updated_at = ?, version = version + 1 WHERE id = ?").run(nowTs, row.id);
    appendAuditEvent(db, {
      entity_id: row.entity_id,
      event_type: "elevation.expired",
      actor: ctx?.actor_id ?? null,
      payload: { elevation_id: row.id, scope: row.scope },
    });
  }
  return { expired: rows.length };
}
