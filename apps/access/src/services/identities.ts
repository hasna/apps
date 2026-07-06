import { getDatabase, now, uuid } from "../db/database.js";
import { appendAuditEvent } from "../db/audit.js";
import { clampLimit, clampOffset } from "../db/crud.js";
import { entityScopeFilter, type AuthorizationContext } from "./authorization.js";
import { authorize } from "./authorization-scopes.js";
import {
  IdentityNotFoundError,
  ValidationError,
  VersionConflictError,
  type Identity,
  type IdentityKind,
  type IdentityStatus,
} from "../types/index.js";

interface IdentityRow {
  id: string;
  entity_id: string;
  entity_slug: string | null;
  kind: IdentityKind;
  name: string;
  owner_ref: string | null;
  status: IdentityStatus;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIdentity(row: IdentityRow): Identity {
  return {
    id: row.id,
    entity_id: row.entity_id,
    entity_slug: row.entity_slug,
    kind: row.kind,
    name: row.name,
    owner_ref: row.owner_ref,
    status: row.status,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version,
  };
}

export interface CreateIdentityInput {
  entity_id: string;
  entity_slug?: string | null;
  kind: IdentityKind;
  name: string;
  owner_ref?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function createIdentity(input: CreateIdentityInput, ctx?: AuthorizationContext): Identity {
  if (!input.name?.trim()) throw new ValidationError("Identity name is required.");
  if (!input.entity_id || !UUID_RE.test(input.entity_id)) {
    throw new ValidationError("entity_id must be an unguessable UUIDv4 home-entity reference.");
  }
  if (!["agent", "service", "human"].includes(input.kind)) {
    throw new ValidationError("kind must be one of agent, service, human.");
  }
  authorize("write", ctx, { entity_id: input.entity_id, resource: "identity" });

  const db = getDatabase();
  const id = uuid();
  const ts = now();
  db.query(
    `INSERT INTO identities (id, entity_id, entity_slug, kind, name, owner_ref, status, metadata, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1)`,
  ).run(
    id,
    input.entity_id,
    input.entity_slug ?? null,
    input.kind,
    input.name.trim(),
    input.owner_ref ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    ts,
    ts,
  );
  appendAuditEvent(db, {
    entity_id: input.entity_id,
    event_type: "identity.created",
    actor: ctx?.actor_id ?? null,
    payload: { identity_id: id, kind: input.kind, name: input.name.trim() },
  });
  return getIdentity(id, ctx);
}

export function getIdentity(id: string, ctx?: AuthorizationContext): Identity {
  const db = getDatabase();
  const row = db.query("SELECT * FROM identities WHERE id = ?").get(id) as IdentityRow | null;
  if (!row) throw new IdentityNotFoundError(id);
  authorize("read", ctx, { entity_id: row.entity_id, resource: "identity" });
  return toIdentity(row);
}

export interface ListIdentitiesFilter {
  entity_id?: string;
  kind?: IdentityKind;
  status?: IdentityStatus;
  limit?: number;
  offset?: number;
}

export function listIdentities(filter: ListIdentitiesFilter = {}, ctx?: AuthorizationContext): Identity[] {
  authorize("read", ctx, filter.entity_id ? { entity_id: filter.entity_id, resource: "identity" } : { resource: "identity" });
  const db = getDatabase();
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter.entity_id) {
    clauses.push("entity_id = ?");
    params.push(filter.entity_id);
  }
  if (filter.kind) {
    clauses.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  // Deny-by-default: isolate to the principal's allowed entity set BY CONSTRUCTION,
  // so an omitted entity_id filter cannot leak other entities' identities.
  const scope = entityScopeFilter(ctx);
  if (scope) {
    clauses.push(scope.clause);
    params.push(...scope.params);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = clampLimit(filter.limit);
  const offset = clampOffset(filter.offset);
  const rows = db
    .query(`SELECT * FROM identities ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as IdentityRow[];
  return rows.map(toIdentity);
}

export interface UpdateIdentityInput {
  name?: string;
  owner_ref?: string | null;
  entity_slug?: string | null;
  metadata?: Record<string, unknown> | null;
  expected_version?: number;
}

export function updateIdentity(id: string, patch: UpdateIdentityInput, ctx?: AuthorizationContext): Identity {
  const db = getDatabase();
  const existing = getIdentity(id, ctx);
  authorize("write", ctx, { entity_id: existing.entity_id, resource: "identity" });
  if (patch.expected_version !== undefined && patch.expected_version !== existing.version) {
    throw new VersionConflictError(patch.expected_version, existing.version);
  }
  db.query(
    `UPDATE identities SET name = ?, owner_ref = ?, entity_slug = ?, metadata = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
  ).run(
    patch.name?.trim() ?? existing.name,
    patch.owner_ref !== undefined ? patch.owner_ref : existing.owner_ref,
    patch.entity_slug !== undefined ? patch.entity_slug : existing.entity_slug,
    patch.metadata !== undefined ? (patch.metadata ? JSON.stringify(patch.metadata) : null) : existing.metadata ? JSON.stringify(existing.metadata) : null,
    now(),
    id,
  );
  return getIdentity(id, ctx);
}

export function setIdentityStatus(id: string, status: IdentityStatus, ctx?: AuthorizationContext): Identity {
  const db = getDatabase();
  const existing = getIdentity(id, ctx);
  authorize("write", ctx, { entity_id: existing.entity_id, resource: "identity" });
  db.query("UPDATE identities SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(status, now(), id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: `identity.${status}`,
    actor: ctx?.actor_id ?? null,
    payload: { identity_id: id, status },
  });
  return getIdentity(id, ctx);
}
