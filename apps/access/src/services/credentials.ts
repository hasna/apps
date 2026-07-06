import { getDatabase, now, uuid } from "../db/database.js";
import { appendAuditEvent } from "../db/audit.js";
import { clampLimit, clampOffset } from "../db/crud.js";
import { entityScopeFilter, type AuthorizationContext } from "./authorization.js";
import { authorize } from "./authorization-scopes.js";
import { getIdentity } from "./identities.js";
import {
  CredentialNotFoundError,
  ValidationError,
  type Credential,
  type CredentialKind,
  type CredentialStatus,
} from "../types/index.js";

interface CredentialRow {
  id: string;
  identity_id: string;
  entity_id: string;
  name: string;
  kind: CredentialKind;
  secret_ref: string;
  status: CredentialStatus;
  created_at: string;
  updated_at: string;
  version: number;
}

const CRED_KINDS = new Set<CredentialKind>(["api_key", "oauth", "mcp_token", "ssh_key", "webhook_secret"]);
// A secret VALUE must never be stored. secret_ref points at @hasna/secrets.
const SECRET_VALUE_HINT = /^(sk-|ghp_|gho_|github_pat_|AKIA|xai-|npm_|-----BEGIN)/;

function toCredential(row: CredentialRow): Credential {
  return { ...row };
}

export interface RegisterCredentialInput {
  identity_id: string;
  name: string;
  kind: CredentialKind;
  secret_ref: string;
}

export function registerCredential(input: RegisterCredentialInput, ctx?: AuthorizationContext): Credential {
  if (!input.name?.trim()) throw new ValidationError("Credential name is required.");
  if (!CRED_KINDS.has(input.kind)) throw new ValidationError(`kind must be one of ${[...CRED_KINDS].join(", ")}.`);
  if (!input.secret_ref?.trim()) throw new ValidationError("secret_ref (a @hasna/secrets reference) is required.");
  if (SECRET_VALUE_HINT.test(input.secret_ref.trim())) {
    throw new ValidationError("secret_ref looks like a raw secret value; store only a @hasna/secrets reference, never the value.");
  }
  const identity = getIdentity(input.identity_id, ctx);
  authorize("write", ctx, { entity_id: identity.entity_id, resource: "credential" });

  const db = getDatabase();
  const id = uuid();
  const ts = now();
  db.query(
    `INSERT INTO credentials (id, identity_id, entity_id, name, kind, secret_ref, status, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)`,
  ).run(id, identity.id, identity.entity_id, input.name.trim(), input.kind, input.secret_ref.trim(), ts, ts);
  appendAuditEvent(db, {
    entity_id: identity.entity_id,
    event_type: "credential.registered",
    actor: ctx?.actor_id ?? null,
    payload: { credential_id: id, identity_id: identity.id, kind: input.kind, secret_ref: input.secret_ref.trim() },
  });
  return getCredential(id, ctx);
}

export function getCredential(id: string, ctx?: AuthorizationContext): Credential {
  const db = getDatabase();
  const row = db.query("SELECT * FROM credentials WHERE id = ?").get(id) as CredentialRow | null;
  if (!row) throw new CredentialNotFoundError(id);
  authorize("read", ctx, { entity_id: row.entity_id, resource: "credential" });
  return toCredential(row);
}

export interface ListCredentialsFilter {
  identity_id?: string;
  entity_id?: string;
  status?: CredentialStatus;
  limit?: number;
  offset?: number;
}

export function listCredentials(filter: ListCredentialsFilter = {}, ctx?: AuthorizationContext): Credential[] {
  authorize("read", ctx, filter.entity_id ? { entity_id: filter.entity_id, resource: "credential" } : { resource: "credential" });
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
    .query(`SELECT * FROM credentials ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, clampLimit(filter.limit), clampOffset(filter.offset)) as CredentialRow[];
  return rows.map(toCredential);
}

export function revokeCredential(id: string, reason: string, ctx?: AuthorizationContext): Credential {
  const db = getDatabase();
  const existing = getCredential(id, ctx);
  authorize("revoke", ctx, { entity_id: existing.entity_id, resource: "credential" });
  db.query("UPDATE credentials SET status = 'revoked', updated_at = ?, version = version + 1 WHERE id = ?").run(now(), id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: "credential.revoked",
    actor: ctx?.actor_id ?? null,
    payload: { credential_id: id, reason },
  });
  return getCredential(id, ctx);
}
