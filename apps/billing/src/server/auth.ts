import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { AuthorizationContext, AuthorizationRole } from "../services/authorization.js";

/**
 * Bearer-credential authentication for @hasna/billing, shared VERBATIM (in
 * mechanism) by the serve tier AND the MCP HTTP transport (BUILD-SPEC
 * §5.1a/§6.3/§10.1). Only the domain scope names are billing-specific; the
 * timing-safe compare, credential model (scopes/roles/entity_ids/expiry/
 * revocation), and deny-by-default enforcement are the copy-verbatim reference
 * stack. This is NOT a per-app design choice.
 *
 * A token maps to a caller principal with scopes + an allowed entity set. The
 * SAME principal is threaded into per-op authorization on both transports — a
 * read-only or single-entity token is denied privileged/cross-entity ops on
 * the MCP transport exactly as on /v1 (BUILD-SPEC failure class 1).
 */
export const apiScopes = [
  "billing:read",
  "billing:write",
  "billing:export",
  "dunning:run",
  "billing:admin",
  "storage:admin",
] as const;

export type ApiScope = (typeof apiScopes)[number];
export type ApiCredentialType = "api_key" | "user" | "session" | "service";

export interface ApiCredentialConfig {
  id: string;
  token?: string;
  key?: string;
  type?: ApiCredentialType;
  actor_id?: string;
  roles?: AuthorizationRole[];
  scopes?: ApiScope[];
  entity_ids?: string[];
  org_ids?: string[];
  expires_at?: string;
  revoked?: boolean;
}

export interface ApiPrincipal extends AuthorizationContext {
  credential_id: string;
  credential_type: ApiCredentialType;
  scopes: ApiScope[];
}

const allScopes = [...apiScopes];
const knownScopes = new Set<ApiScope>(allScopes);
const knownRoles = new Set<AuthorizationRole>([
  "system",
  "owner",
  "admin",
  "billing_manager",
  "dunning_operator",
  "integration",
  "auditor",
  "readonly",
]);

const roleScopes: Record<AuthorizationRole, ApiScope[]> = {
  system: allScopes,
  owner: allScopes,
  admin: allScopes,
  billing_manager: ["billing:read", "billing:write", "billing:export", "dunning:run"],
  dunning_operator: ["billing:read", "dunning:run"],
  integration: ["billing:read", "billing:write"],
  auditor: ["billing:read", "billing:export"],
  readonly: ["billing:read"],
};

export function scopesForRoles(roles: AuthorizationRole[]): ApiScope[] {
  return Array.from(new Set(roles.flatMap((role) => roleScopes[role] || [])));
}

export function isApiAuthConfigured(): boolean {
  return Boolean(process.env["HASNA_BILLING_API_CREDENTIALS"] || process.env["BILLING_API_CREDENTIALS"]);
}

export function configuredApiCredentials(): ApiCredentialConfig[] {
  const raw = process.env["HASNA_BILLING_API_CREDENTIALS"] || process.env["BILLING_API_CREDENTIALS"];
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

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isExpired(expiresAt?: string): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
}

function normalizeRoles(roles: AuthorizationRole[] = ["integration"]): AuthorizationRole[] {
  const normalized = roles.filter((role) => knownRoles.has(role));
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ["integration"];
}

function normalizeScopes(scopes?: ApiScope[]): ApiScope[] | null {
  if (!scopes) return null;
  return Array.from(new Set(scopes.filter((scope) => knownScopes.has(scope))));
}

/** Extract the bearer token from an Authorization header value. */
export function bearerFromHeader(header: string | null | undefined): string {
  const auth = header || "";
  if (!auth) return "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
}

/**
 * Authenticate a raw bearer token to a principal, or null. Timing-safe compare;
 * honors expiry + revocation. Shared by serve and MCP transports.
 */
export function authenticateToken(token: string): ApiPrincipal | null {
  if (!token) return null;

  // NOTE (BUILD-SPEC §5.1a): billing is a money app, so there is deliberately NO
  // shared-static-key path. A single shared string mapping to owner+bypass+all-
  // entities would grant non-attributable cross-tenant god access and defeat
  // segregation-of-duties. Every externally-presented token MUST map to a
  // distinct credential with explicit scopes and a bounded entity set via
  // HASNA_BILLING_API_CREDENTIALS; bypass is reserved for the in-process SYSTEM
  // bootstrap context only, never for a token off the wire.
  for (const credential of configuredApiCredentials()) {
    const secret = credential.token || credential.key || "";
    if (!safeEqual(token, secret) || credential.revoked || isExpired(credential.expires_at)) continue;
    const roles = normalizeRoles(credential.roles);
    const scopes = normalizeScopes(credential.scopes) || scopesForRoles(roles);
    const principal: ApiPrincipal = {
      actor_id: credential.actor_id || `${credential.type || "api_key"}:${credential.id}`,
      credential_id: credential.id,
      credential_type: credential.type || "api_key",
      roles,
      scopes,
    };
    if (credential.entity_ids) principal.entity_ids = credential.entity_ids;
    if (credential.org_ids) principal.org_ids = credential.org_ids;
    return principal;
  }

  return null;
}

export interface ScopeCheck {
  allowed: boolean;
  status?: number;
  code?: "UNAUTHORIZED" | "PERMISSION_DENIED";
  message?: string;
  required_scopes?: ApiScope[];
}

/** Assert a principal holds all required scopes. */
export function requireScopes(principal: ApiPrincipal | null, required: ApiScope[]): ScopeCheck {
  if (!principal) {
    return { allowed: false, status: 401, code: "UNAUTHORIZED", message: "Invalid or missing bearer credential." };
  }
  const missing = required.filter((scope) => !principal.scopes.includes(scope));
  if (missing.length > 0) {
    return {
      allowed: false,
      status: 403,
      code: "PERMISSION_DENIED",
      message: `Credential lacks required scope: ${missing.join(", ")}.`,
      required_scopes: required,
    };
  }
  return { allowed: true };
}
