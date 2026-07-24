import type { Tenant, TenantStatus, Token, User, UserStatus } from "../tenancy/types.js";

/**
 * Backend-tagged storage interface for the multi-tenancy backend, per
 * hasna-storage-standard (open-loops adapter pattern). Every method is async;
 * both the SQLite and PostgreSQL adapters implement this exact contract, and
 * every surface (server/SDK) consumes it — no per-surface handlers.
 *
 * TENANT ISOLATION CONTRACT: tenant-scoped reads/writes take an explicit
 * `tenantId` and MUST NOT return or mutate rows owned by a different tenant.
 * The `*Global` methods deliberately cross tenants and exist ONLY to back the
 * super-admin plane; ordinary request paths never call them.
 */
export interface AuthStorage {
  readonly backend: "sqlite" | "postgres";

  /** Apply pending schema migrations. `dryRun` reports pending without applying (feeds /ready). */
  migrate(opts?: { dryRun?: boolean }): Promise<{ applied: string[]; pending: string[] }>;

  // --- Tenants ---
  createTenant(input: Omit<Tenant, "createdAt" | "updatedAt">): Promise<Tenant>;
  getTenantById(id: string): Promise<Tenant | null>;
  getTenantBySlug(slug: string): Promise<Tenant | null>;
  setTenantStatus(id: string, status: TenantStatus): Promise<Tenant | null>;
  /** Super-admin plane only: every tenant across the deployment. */
  listTenantsGlobal(): Promise<Tenant[]>;

  // --- Users ---
  createUser(input: Omit<User, "createdAt" | "updatedAt">): Promise<User>;
  /** Login lookup. Email is globally unique, so this crosses tenants by design. */
  getUserByEmail(email: string): Promise<User | null>;
  /** Tenant-scoped read: returns null if the id belongs to a different tenant. */
  getUserById(tenantId: string, id: string): Promise<User | null>;
  /** Tenant-scoped listing. */
  listUsers(tenantId: string): Promise<User[]>;
  setUserStatus(tenantId: string, id: string, status: UserStatus): Promise<User | null>;
  setUserRole(tenantId: string, id: string, role: User["role"]): Promise<User | null>;
  updatePassword(tenantId: string, id: string, passwordHash: string): Promise<void>;
  /** Super-admin plane only: any user across tenants. */
  getUserByIdGlobal(id: string): Promise<User | null>;
  /** Super-admin plane only: every user across the deployment. */
  listUsersGlobal(): Promise<User[]>;

  // --- Tokens (sessions + API keys) ---
  createToken(input: Omit<Token, "createdAt" | "lastUsedAt" | "revokedAt">): Promise<Token>;
  getTokenByHash(tokenHash: string): Promise<Token | null>;
  touchToken(tokenHash: string, when: string): Promise<void>;
  revokeToken(tokenHash: string): Promise<void>;
  /** Tenant-scoped: revoke every token for a user. Returns count revoked. */
  revokeAllUserTokens(tenantId: string, userId: string): Promise<number>;
  /** Tenant-scoped listing of a user's live tokens (hashes only, never plaintext). */
  listUserTokens(tenantId: string, userId: string): Promise<Token[]>;

  close(): Promise<void>;
}
