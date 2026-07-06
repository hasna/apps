import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { AuthorizationContext, AuthorizationRole } from "../services/authorization.js";

// Copied structurally from the reference security stack (iapp-accounting
// src/server/auth.ts): scope list, role->scope map, ApiCredentialConfig with
// scopes/roles/org_ids/entity_ids/expires_at/revoked, and a timingSafeEqual
// bearer compare. Only the DOMAIN SCOPE names are parameterized to fleet. The
// same credential model backs BOTH the serve tier and the MCP HTTP transport.

export const apiScopes = [
  "fleet:read",
  "fleet:write",
  "fleet:export",
  "fleet:admin",
  "storage:admin",
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
  org_id?: string;
  org_ids?: string[];
  entity_ids?: string[];
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
  "editor",
  "viewer",
  "integration",
  "auditor",
]);

const roleScopes: Record<AuthorizationRole, ApiScope[]> = {
  system: allScopes,
  owner: allScopes,
  admin: allScopes,
  editor: ["fleet:read", "fleet:write", "fleet:export"],
  viewer: ["fleet:read"],
  integration: ["fleet:read"],
  auditor: ["fleet:read", "fleet:export"],
};

export function scopesForRoles(roles: AuthorizationRole[]): ApiScope[] {
  return Array.from(new Set(roles.flatMap((role) => roleScopes[role] || [])));
}

const CRED_ENV_KEYS = ["HASNA_FLEET_API_CREDENTIALS", "FLEET_API_CREDENTIALS", "HASNA_FLEET_API_KEYS"] as const;
const LEGACY_KEY_ENV = ["HASNA_FLEET_API_KEY", "FLEET_API_KEY"] as const;

function legacyApiKey(): string | undefined {
  for (const key of LEGACY_KEY_ENV) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function isApiAuthConfigured(): boolean {
  return Boolean(legacyApiKey() || CRED_ENV_KEYS.some((k) => process.env[k]));
}

export function configuredApiCredentials(): ApiCredentialConfig[] {
  const raw = CRED_ENV_KEYS.map((k) => process.env[k]).find((v) => v && v.trim());
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

/** Authenticate a raw bearer token to a principal (shared by serve + MCP). */
export function authenticateToken(token: string): ApiPrincipal | null {
  if (!token) return null;

  const legacy = legacyApiKey();
  if (legacy && safeEqual(token, legacy)) {
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
    const principal: ApiPrincipal = {
      actor_id: credential.actor_id || `${credential.type || "api_key"}:${credential.id}`,
      credential_id: credential.id,
      credential_type: credential.type || "api_key",
      roles,
      scopes,
    };
    if (credential.org_id !== undefined) principal.org_id = credential.org_id;
    if (credential.org_ids !== undefined) principal.org_ids = credential.org_ids;
    if (credential.entity_ids !== undefined) principal.entity_ids = credential.entity_ids;
    return principal;
  }
  return null;
}

export function bearerToken(req: Request): string {
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
}

export function authenticateApiRequest(req: Request): ApiPrincipal | null {
  return authenticateToken(bearerToken(req));
}

/** Owner/system principal used in local unauthenticated mode and for the CLI. */
export function localOwnerPrincipal(): ApiPrincipal {
  return {
    actor_id: "local-cli",
    credential_id: "local-cli",
    credential_type: "api_key",
    roles: ["owner"],
    scopes: allScopes,
    bypass: true,
  };
}

export function principalHasScopes(principal: ApiPrincipal, required: ApiScope[]): ApiScope[] {
  return required.filter((scope) => !principal.scopes.includes(scope));
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
