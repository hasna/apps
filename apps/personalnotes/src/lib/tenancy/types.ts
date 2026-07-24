/** Core tenancy domain model shared by every storage engine and surface. */

export type TenantStatus = "active" | "suspended";

/** Role WITHIN a tenant. Global super-admin is a separate flag on the user. */
export const TENANT_ROLES = ["owner", "admin", "member"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export type UserStatus = "active" | "suspended";

export type TokenKind = "session" | "api";

export interface Tenant {
  id: string;
  /** URL-safe unique handle, e.g. "acme". */
  slug: string;
  name: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  tenantId: string;
  /** Globally unique, lowercased. Login identifier. */
  email: string;
  passwordHash: string;
  displayName: string;
  role: TenantRole;
  /** Global super administrator (crosses tenant boundaries). */
  isSuperAdmin: boolean;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

/** A persisted credential: a session token (login) or a long-lived API token (CLI/agent). */
export interface Token {
  id: string;
  tenantId: string;
  userId: string;
  kind: TokenKind;
  /** sha256 of the presented secret; the plaintext is never stored. */
  tokenHash: string;
  /** Non-secret label / device name. */
  label: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The authenticated caller, resolved from a bearer token. */
export interface AuthContext {
  tenantId: string;
  userId: string;
  email: string;
  role: TenantRole;
  isSuperAdmin: boolean;
  tokenKind: TokenKind;
  tokenId: string;
}

/** Public projection of a user (never leaks the password hash). */
export interface PublicUser {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: TenantRole;
  isSuperAdmin: boolean;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}
