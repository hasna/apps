import { Buffer } from "node:buffer";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getDatabase, now, uuid } from "../db/database.js";
import { appendAuditEvent } from "../db/audit.js";
import { clampLimit, clampOffset } from "../db/crud.js";
import { entityScopeFilter, type AuthorizationContext } from "./authorization.js";
import { authorize } from "./authorization-scopes.js";
import { getIdentity } from "./identities.js";
import { effectiveScopes } from "./scopes.js";
import {
  TokenNotFoundError,
  TokenVerificationError,
  ValidationError,
  type IssuedToken,
  type TokenStatus,
} from "../types/index.js";

/**
 * access is the cohort MCP bearer-token ISSUER. Tokens are HMAC-SHA256 signed
 * with a dev-mode local signing key. Only the token HASH is stored (never the
 * raw token). Verification checks signature (timing-safe), expiry, and that the
 * jti is still active (not revoked).
 */

const DEFAULT_TTL_MINUTES = 60;
const DEV_SIGNING_KEY = "access-dev-signing-key-local-only-do-not-use-in-prod";

function signingKey(): string {
  return process.env["HASNA_ACCESS_TOKEN_SIGNING_KEY"]?.trim() || process.env["ACCESS_TOKEN_SIGNING_KEY"]?.trim() || DEV_SIGNING_KEY;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", signingKey()).update(body).digest("base64url");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

interface TokenRow {
  id: string;
  jti: string;
  identity_id: string;
  entity_id: string;
  credential_id: string | null;
  scopes: string;
  entity_ids: string;
  token_hash: string;
  status: TokenStatus;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

function toToken(row: TokenRow): IssuedToken {
  return {
    id: row.id,
    jti: row.jti,
    identity_id: row.identity_id,
    entity_id: row.entity_id,
    credential_id: row.credential_id,
    scopes: JSON.parse(row.scopes) as string[],
    entity_ids: JSON.parse(row.entity_ids) as string[],
    token_hash: row.token_hash,
    status: row.status,
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
  };
}

export interface IssueTokenInput {
  identity_id: string;
  scopes?: string[];
  entity_ids?: string[];
  credential_id?: string | null;
  ttl_minutes?: number;
}

export interface IssuedTokenResult {
  token: string;
  record: IssuedToken;
}

export function issueToken(input: IssueTokenInput, ctx?: AuthorizationContext): IssuedTokenResult {
  const identity = getIdentity(input.identity_id, ctx);
  authorize("issue", ctx, { entity_id: identity.entity_id, resource: "token" });

  // Default to the identity's effective granted scopes; a caller may narrow but
  // not widen beyond what is granted.
  const granted = new Set(effectiveScopes(identity.id, ctx));
  const requested = input.scopes?.length ? input.scopes : [...granted];
  const widened = requested.filter((s) => !granted.has(s));
  if (widened.length > 0) {
    throw new ValidationError(`Cannot issue token with un-granted scopes: ${widened.join(", ")}. Grant them or request an elevation first.`);
  }

  const entityIds = input.entity_ids?.length ? input.entity_ids : [identity.entity_id];
  const jti = randomUUID();
  const issuedAt = now();
  const expiresAt = new Date(Date.now() + (input.ttl_minutes ?? DEFAULT_TTL_MINUTES) * 60_000).toISOString();

  const header = b64url(JSON.stringify({ alg: "HS256", typ: "HAT", iss: "access" }));
  const payload = b64url(
    JSON.stringify({ jti, sub: identity.id, ent: entityIds, scp: requested, iat: issuedAt, exp: expiresAt }),
  );
  const signature = sign(`${header}.${payload}`);
  const token = `${header}.${payload}.${signature}`;

  const db = getDatabase();
  const id = uuid();
  db.query(
    `INSERT INTO issued_tokens (id, jti, identity_id, entity_id, credential_id, scopes, entity_ids, token_hash, status, issued_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
  ).run(
    id,
    jti,
    identity.id,
    identity.entity_id,
    input.credential_id ?? null,
    JSON.stringify(requested),
    JSON.stringify(entityIds),
    sha256(token),
    issuedAt,
    expiresAt,
  );
  appendAuditEvent(db, {
    entity_id: identity.entity_id,
    event_type: "token.issued",
    actor: ctx?.actor_id ?? null,
    payload: { token_id: id, jti, scopes: requested, entity_ids: entityIds, expires_at: expiresAt },
  });
  return { token, record: getToken(id, ctx) };
}

export interface VerifiedToken {
  valid: boolean;
  identity_id: string;
  scopes: string[];
  entity_ids: string[];
  jti: string;
  expires_at: string;
}

/** Verify a presented bearer token: signature, expiry, and active status. */
export function verifyToken(token: string): VerifiedToken {
  const parts = token.split(".");
  if (parts.length !== 3) throw new TokenVerificationError("Malformed token.");
  const [header, payload, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${payload}`);
  if (!safeEqual(signature, expected)) throw new TokenVerificationError("Bad token signature.");

  let claims: { jti?: string; sub?: string; ent?: string[]; scp?: string[]; exp?: string };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new TokenVerificationError("Unreadable token payload.");
  }
  if (!claims.jti || !claims.sub || !claims.exp) throw new TokenVerificationError("Token missing required claims.");
  if (Date.parse(claims.exp) <= Date.now()) throw new TokenVerificationError("Token expired.");

  const db = getDatabase();
  const row = db.query("SELECT * FROM issued_tokens WHERE jti = ?").get(claims.jti) as TokenRow | null;
  if (!row) throw new TokenVerificationError("Token not recognized (unknown jti).");
  if (row.status !== "active") throw new TokenVerificationError("Token has been revoked.");
  if (!safeEqual(row.token_hash, sha256(token))) throw new TokenVerificationError("Token hash mismatch.");

  return {
    valid: true,
    identity_id: row.identity_id,
    scopes: JSON.parse(row.scopes) as string[],
    entity_ids: JSON.parse(row.entity_ids) as string[],
    jti: row.jti,
    expires_at: row.expires_at,
  };
}

export function getToken(id: string, ctx?: AuthorizationContext): IssuedToken {
  const db = getDatabase();
  const row = db.query("SELECT * FROM issued_tokens WHERE id = ?").get(id) as TokenRow | null;
  if (!row) throw new TokenNotFoundError(id);
  authorize("read", ctx, { entity_id: row.entity_id, resource: "token" });
  return toToken(row);
}

export interface ListTokensFilter {
  identity_id?: string;
  entity_id?: string;
  status?: TokenStatus;
  limit?: number;
  offset?: number;
}

export function listTokens(filter: ListTokensFilter = {}, ctx?: AuthorizationContext): IssuedToken[] {
  authorize("read", ctx, filter.entity_id ? { entity_id: filter.entity_id, resource: "token" } : { resource: "token" });
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
    .query(`SELECT * FROM issued_tokens ${where} ORDER BY issued_at DESC LIMIT ? OFFSET ?`)
    .all(...params, clampLimit(filter.limit), clampOffset(filter.offset)) as TokenRow[];
  return rows.map(toToken);
}

export function revokeToken(id: string, reason: string, ctx?: AuthorizationContext): IssuedToken {
  const db = getDatabase();
  const existing = getToken(id, ctx);
  authorize("revoke", ctx, { entity_id: existing.entity_id, resource: "token" });
  db.query("UPDATE issued_tokens SET status = 'revoked', revoked_at = ? WHERE id = ?").run(now(), id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: "token.revoked",
    actor: ctx?.actor_id ?? null,
    payload: { token_id: id, jti: existing.jti, reason },
  });
  return getToken(id, ctx);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
