/**
 * Request authentication + tenant binding, fail-closed, per
 * _AUTH-TENANCY-STANDARD-v2.md §1/§2/§4.
 *
 * Three credential paths, in priority order:
 *   1. Static bootstrap key (env HASNA_SANDBOXES_API_KEY) -> ROOT tenant admin.
 *      This is the break-glass/provisioning key; every OTHER credential must
 *      resolve a real tenant or the request is rejected 403.
 *   2. v2 identities JWS (Bearer), verified via cached JWKS. Dormant until
 *      HASNA_IDENTITIES_JWKS_URL is configured (identities v2 not yet live).
 *   3. v1/bridge API key: sha256(token) -> api_keys row -> (tenant,user,scopes).
 *      No row / null tenant / revoked / expired => 403 (never default-tenant).
 *
 * Tenant / user / principal_type are ALWAYS server-derived here — never read
 * from a request body.
 */
import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";
import {
  APP_NAME,
  ROOT_TENANT_ID,
  BOOTSTRAP_PRINCIPAL_ID,
  type AuthContext,
  type PrincipalType,
} from "./context.js";
import { HttpError } from "./envelope.js";
import type { ControlPlaneStore } from "./store.js";

export interface AuthConfig {
  /** Static bootstrap admin key (maps to ROOT tenant). */
  bootstrapKey?: string | undefined;
  /** identities JWKS endpoint; enables the v2 JWS path when set. */
  jwksUrl?: string | undefined;
  /** Expected issuer for v2 tokens. */
  issuer?: string | undefined;
  /** JWKS cache TTL ms (default 10 min). */
  jwksTtlMs?: number | undefined;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

/** Extract a token from Authorization: Bearer or x-api-key (Bearer preferred). */
export function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (bearer) return bearer;
  }
  const headerKey = req.headers.get("x-api-key");
  if (headerKey) return headerKey.trim();
  return null;
}

// --- v2 JWS verification (dormant until JWKS configured) --------------------

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

interface JwksCacheEntry {
  fetchedAt: number;
  keys: Jwk[];
}

const jwksCache = new Map<string, JwksCacheEntry>();

async function fetchJwks(url: string, ttlMs: number): Promise<Jwk[]> {
  const cached = jwksCache.get(url);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < ttlMs) return cached.keys;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    if (cached) return cached.keys; // survive a transient JWKS outage on cached keys
    throw new HttpError(503, "dependency_unavailable", "identities JWKS endpoint is unreachable");
  }
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(url, { fetchedAt: now, keys });
  return keys;
}

function b64uToBuf(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  tid?: string;
  uid?: string;
  pt?: string;
  scope?: string;
  scopes?: string[];
}

async function verifyJws(token: string, config: AuthConfig): Promise<AuthContext> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "unauthenticated", "Malformed access token");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: JwtClaims;
  try {
    header = JSON.parse(b64uToBuf(headerB64).toString("utf8")) as { alg?: string; kid?: string };
    claims = JSON.parse(b64uToBuf(payloadB64).toString("utf8")) as JwtClaims;
  } catch {
    throw new HttpError(401, "unauthenticated", "Unreadable access token");
  }
  const keys = await fetchJwks(config.jwksUrl!, config.jwksTtlMs ?? 600_000);
  const jwk = keys.find((k) => (header.kid ? k.kid === header.kid : true));
  if (!jwk) throw new HttpError(401, "unauthenticated", "No matching signing key");

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  const signature = b64uToBuf(sigB64);
  const keyObject = createPublicKey({ key: jwk as object, format: "jwk" });
  let valid = false;
  if (header.alg === "EdDSA") {
    valid = cryptoVerify(null, signingInput, keyObject, signature);
  } else if (header.alg === "RS256") {
    valid = cryptoVerify("sha256", signingInput, keyObject, signature);
  } else {
    throw new HttpError(401, "unauthenticated", `Unsupported token alg ${String(header.alg)}`);
  }
  if (!valid) throw new HttpError(401, "unauthenticated", "Invalid token signature");

  if (config.issuer && claims.iss !== config.issuer) {
    throw new HttpError(401, "unauthenticated", "Untrusted token issuer");
  }
  // Assert the token was minted FOR this app (§1.3): a missing/empty audience
  // is rejected, never treated as "audience-less, therefore ok".
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!aud.includes(APP_NAME)) {
    throw new HttpError(403, "forbidden", "Token audience does not include sandboxes");
  }
  // v2 access tokens are short-lived (≤24h); a token with no exp is rejected.
  if (typeof claims.exp !== "number") {
    throw new HttpError(401, "unauthenticated", "Access token has no expiry");
  }
  if (claims.exp * 1000 < Date.now()) {
    throw new HttpError(401, "unauthenticated", "Access token expired");
  }
  if (!claims.tid) throw new HttpError(403, "tenant_unresolved", "Token carries no tenant");
  const scopes = claims.scopes ?? (claims.scope ? claims.scope.split(/\s+/).filter(Boolean) : []);
  return {
    tenantId: claims.tid,
    userId: claims.uid ?? null,
    principalType: (claims.pt as PrincipalType) ?? "service",
    scopes,
    kid: header.kid ?? null,
    via: "jws",
  };
}

function looksLikeJws(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(b64uToBuf(parts[0]!).toString("utf8")) as { alg?: unknown };
    return typeof header.alg === "string";
  } catch {
    return false;
  }
}

// --- top-level resolver -----------------------------------------------------

/**
 * Resolve a verified AuthContext or throw an HttpError (401/403). Fail-closed:
 * a missing token is 401; a token that resolves no tenant is 403.
 */
export async function resolveContext(
  req: Request,
  store: ControlPlaneStore,
  config: AuthConfig,
): Promise<AuthContext> {
  const token = extractToken(req);
  if (!token) throw new HttpError(401, "unauthenticated", "Missing credential");

  // 1. Static bootstrap key -> ROOT tenant admin.
  if (config.bootstrapKey && safeEqual(token, config.bootstrapKey)) {
    return {
      tenantId: ROOT_TENANT_ID,
      userId: BOOTSTRAP_PRINCIPAL_ID,
      principalType: "service",
      scopes: ["sandboxes:*"],
      kid: "bootstrap",
      via: "bootstrap",
    };
  }

  // 2. v2 identities JWS (dormant until JWKS configured).
  if (config.jwksUrl && looksLikeJws(token)) {
    return verifyJws(token, config);
  }

  // 3. v1/bridge API key: hash -> row -> binding.
  const binding = await store.getApiKeyByHash(hashToken(token));
  if (!binding) throw new HttpError(401, "unauthenticated", "Unknown credential");
  if (binding.app !== APP_NAME) throw new HttpError(403, "forbidden", "Credential is for a different app");
  if (binding.revoked_at) throw new HttpError(401, "unauthenticated", "Credential revoked");
  if (binding.expires_at && Date.parse(binding.expires_at) < Date.now()) {
    throw new HttpError(401, "unauthenticated", "Credential expired");
  }
  if (!binding.tenant_id) throw new HttpError(403, "tenant_unresolved", "Credential resolves no tenant");
  return {
    tenantId: binding.tenant_id,
    userId: binding.user_id,
    principalType: binding.principal_type,
    scopes: binding.scopes,
    kid: binding.kid,
    via: "api_key",
  };
}

/** Build AuthConfig from environment. */
export function authConfigFromEnv(env: Record<string, string | undefined> = process.env): AuthConfig {
  return {
    bootstrapKey: env["HASNA_SANDBOXES_API_KEY"] || undefined,
    jwksUrl: env["HASNA_IDENTITIES_JWKS_URL"] || undefined,
    issuer: env["HASNA_IDENTITIES_ISSUER"] || "identities",
    jwksTtlMs: env["HASNA_SANDBOXES_JWKS_TTL_MS"] ? Number(env["HASNA_SANDBOXES_JWKS_TTL_MS"]) : undefined,
  };
}
