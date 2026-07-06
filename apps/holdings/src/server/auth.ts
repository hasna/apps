import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { AuthorizationRole } from "../services/authorization.js";

// Bearer-credential authentication, adapted in mechanism verbatim from the
// reference accounting `auth.ts` (§6.3/§10.1): ApiCredentialConfig with
// scopes/roles/entity scoping/expiry/revocation, timing-safe bearer compare.
// Shared by BOTH the serve tier and the MCP HTTP transport (§5.1a).

export const apiScopes = [
  "holdings:read",
  "holdings:write",
  "holdings:register",
  "holdings:renew",
  "holdings:export",
  "storage:admin",
  "org:admin",
] as const;

export type ApiScope = (typeof apiScopes)[number];
export type ApiCredentialType = "api_key" | "user" | "session";

export interface ApiCredentialConfig {
  id: string;
  token?: string;
  key?: string;
  type?: ApiCredentialType;
  actor_id?: string;
  roles?: AuthorizationRole[];
  scopes?: ApiScope[];
  entity_id?: string;
  entity_ids?: string[];
  expires_at?: string;
  revoked?: boolean;
}

export interface ApiPrincipal {
  actor_id: string;
  credential_id: string;
  credential_type: ApiCredentialType;
  roles: AuthorizationRole[];
  scopes: ApiScope[];
  entity_id?: string;
  entity_ids?: string[];
}

const allScopes = [...apiScopes];
const knownScopes = new Set<ApiScope>(allScopes);

export const ALL_ROLES: AuthorizationRole[] = [
  "system",
  "owner",
  "admin",
  "holdings_manager",
  "paralegal",
  "viewer",
  "auditor",
  "integration",
];
const knownRoles = new Set<AuthorizationRole>(ALL_ROLES);

const roleScopes: Record<AuthorizationRole, ApiScope[]> = {
  system: allScopes,
  owner: allScopes,
  admin: allScopes,
  holdings_manager: ["holdings:read", "holdings:write", "holdings:register", "holdings:renew", "holdings:export"],
  paralegal: ["holdings:read", "holdings:write", "holdings:register", "holdings:renew"],
  viewer: ["holdings:read"],
  auditor: ["holdings:read", "holdings:export"],
  integration: ["holdings:read", "holdings:write", "holdings:export"],
};

export function scopesForRoles(roles: AuthorizationRole[]): ApiScope[] {
  return Array.from(new Set(roles.flatMap((role) => roleScopes[role] || [])));
}

export function isApiAuthConfigured(): boolean {
  return Boolean(getApiKey() || process.env["HASNA_HOLDINGS_API_CREDENTIALS"] || process.env["HOLDINGS_API_CREDENTIALS"]);
}

export function getApiKey(): string | undefined {
  return process.env["HASNA_HOLDINGS_API_KEY"]?.trim() || process.env["HOLDINGS_API_KEY"]?.trim() || undefined;
}

export function configuredApiCredentials(): ApiCredentialConfig[] {
  const raw = process.env["HASNA_HOLDINGS_API_CREDENTIALS"] || process.env["HOLDINGS_API_CREDENTIALS"];
  if (!raw) return [];
  let parsed: ApiCredentialConfig[] | ApiCredentialConfig;
  try {
    parsed = JSON.parse(raw) as ApiCredentialConfig[] | ApiCredentialConfig;
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter((cred) => Boolean((cred.token || cred.key) && cred.id));
}

export function bearerToken(headerValue: string | null | undefined): string {
  const auth = headerValue || "";
  if (!auth) return "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
}

export function authenticateBearer(token: string): ApiPrincipal | null {
  if (!token) return null;

  const legacyKey = getApiKey();
  if (legacyKey && safeEqual(token, legacyKey)) {
    return {
      actor_id: "legacy-api-key",
      credential_id: "legacy-api-key",
      credential_type: "api_key",
      roles: ["owner"],
      scopes: allScopes,
    };
  }

  for (const credential of configuredApiCredentials()) {
    const secret = credential.token || credential.key || "";
    if (!safeEqual(token, secret) || credential.revoked || isExpired(credential.expires_at)) continue;
    const roles = normalizeRoles(credential.roles);
    const scopes = normalizeScopes(credential.scopes) || scopesForRoles(roles);
    return {
      actor_id: credential.actor_id || `${credential.type || "api_key"}:${credential.id}`,
      credential_id: credential.id,
      credential_type: credential.type || "api_key",
      roles,
      scopes,
      entity_id: credential.entity_id,
      entity_ids: credential.entity_ids,
    };
  }
  return null;
}

export function principalHasScope(principal: ApiPrincipal, scope: ApiScope): boolean {
  return principal.scopes.includes(scope);
}

export function principalHasEntity(principal: ApiPrincipal, entityId?: string): boolean {
  if (!entityId) return true;
  if (principal.roles.some((r) => r === "system" || r === "owner" || r === "admin")) return true;
  if (principal.entity_id && principal.entity_id === entityId) return true;
  if (principal.entity_ids && principal.entity_ids.includes(entityId)) return true;
  return false;
}

function normalizeRoles(roles: AuthorizationRole[] = ["integration"]): AuthorizationRole[] {
  const normalized = roles.filter((role) => knownRoles.has(role));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["integration"];
}

function normalizeScopes(scopes?: ApiScope[]): ApiScope[] | null {
  if (!scopes) return null;
  return Array.from(new Set(scopes.filter((scope) => knownScopes.has(scope))));
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isExpired(expiresAt?: string): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
}
