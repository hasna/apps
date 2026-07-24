import { randomUUID } from "node:crypto";
import type { BackendConfig } from "../config.js";
import { resolveConfig } from "../config.js";
import { AuthError } from "../errors.js";
import type { AuthStorage } from "../storage/contract.js";
import {
  toPublicUser,
  type AuthContext,
  type PublicUser,
  type Tenant,
  type TenantRole,
  type Token,
  type User,
} from "../tenancy/types.js";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./passwords.js";
import { generateToken, hashToken, tokenKindOf } from "./tokens.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
  /** Human name for the new tenant; defaults to a name derived from the email. */
  tenantName?: string;
}

export interface AuthResult {
  user: PublicUser;
  tenant: Tenant;
  /** Plaintext bearer token — returned once, never persisted. */
  token: string;
  tokenKind: "session" | "api";
  expiresAt: string | null;
}

export interface IssuedToken {
  token: string;
  record: Omit<Token, "tokenHash">;
}

function normalizeEmail(email: unknown): string {
  if (typeof email !== "string") throw new AuthError("invalid_request", "email is required");
  const value = email.trim().toLowerCase();
  if (!EMAIL_RE.test(value)) throw new AuthError("invalid_request", "email is not valid");
  return value;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tenant"
  );
}

/**
 * The multi-tenancy backend. Owns registration/login, session + API tokens,
 * per-tenant isolation, and the single global super-admin plane
 * (default super admin: andrei@hasna.com). Every surface (HTTP server, SDK,
 * CLI) drives this one service — there are no duplicated handlers.
 */
export class AuthService {
  constructor(
    private readonly storage: AuthStorage,
    private readonly config: BackendConfig = resolveConfig(),
    private readonly now: () => number = Date.now,
  ) {}

  get superAdminEmail(): string {
    return this.config.superAdminEmail;
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  private async ensureUniqueSlug(base: string): Promise<string> {
    const root = slugify(base);
    let candidate = root;
    for (let i = 0; i < 50; i++) {
      const existing = await this.storage.getTenantBySlug(candidate);
      if (!existing) return candidate;
      candidate = `${root}-${i + 2}`;
    }
    return `${root}-${randomUUID().slice(0, 8)}`;
  }

  /** Register a brand-new tenant with its first user (the tenant owner). */
  async register(input: RegisterInput): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    const pwError = validatePasswordStrength(input.password);
    if (pwError) throw new AuthError("invalid_request", pwError);

    const existing = await this.storage.getUserByEmail(email);
    if (existing) throw new AuthError("email_taken", "an account with this email already exists");

    const isSuperAdmin = email === this.config.superAdminEmail;
    const tenantName = (input.tenantName ?? `${email.split("@")[0]}'s workspace`).trim() || "workspace";
    const slug = await this.ensureUniqueSlug(input.tenantName ?? email.split("@")[0] ?? "tenant");

    const tenant = await this.storage.createTenant({
      id: randomUUID(),
      slug,
      name: tenantName,
      status: "active",
    });

    const passwordHash = await hashPassword(input.password);
    const user = await this.storage.createUser({
      id: randomUUID(),
      tenantId: tenant.id,
      email,
      passwordHash,
      displayName: (input.displayName ?? "").trim(),
      role: "owner",
      isSuperAdmin,
      status: "active",
    });

    const issued = await this.issueToken(user, "session");
    return {
      user: toPublicUser(user),
      tenant,
      token: issued.token,
      tokenKind: "session",
      expiresAt: issued.record.expiresAt,
    };
  }

  /** Authenticate with email + password and mint a session token. */
  async login(email: string, password: string): Promise<AuthResult> {
    const normalized = normalizeEmail(email);
    const user = await this.storage.getUserByEmail(normalized);
    // Verify against a real-looking hash even when the user is missing, to blunt timing/enumeration.
    const ok = await verifyPassword(
      typeof password === "string" ? password : "",
      user?.passwordHash ?? "$argon2id$v=19$m=65536,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    if (!user || !ok) throw new AuthError("invalid_credentials", "invalid email or password");
    if (user.status !== "active") throw new AuthError("user_suspended", "this account is suspended");

    const tenant = await this.storage.getTenantById(user.tenantId);
    if (!tenant) throw new AuthError("invalid_credentials", "invalid email or password");
    if (tenant.status !== "active") throw new AuthError("tenant_suspended", "this workspace is suspended");

    const issued = await this.issueToken(user, "session");
    return {
      user: toPublicUser(user),
      tenant,
      token: issued.token,
      tokenKind: "session",
      expiresAt: issued.record.expiresAt,
    };
  }

  private async issueToken(user: User, kind: "session" | "api", label = ""): Promise<IssuedToken> {
    const { token, tokenHash } = generateToken(kind);
    const expiresAt =
      kind === "session"
        ? new Date(this.now() + this.config.sessionTtlSeconds * 1000).toISOString()
        : null;
    const record = await this.storage.createToken({
      id: randomUUID(),
      tenantId: user.tenantId,
      userId: user.id,
      kind,
      tokenHash,
      label,
      expiresAt,
    });
    const { tokenHash: _omit, ...safe } = record;
    return { token, record: safe };
  }

  /** Resolve a bearer token to an AuthContext, or throw AuthError. Touches last-used. */
  async authenticate(token: string): Promise<AuthContext> {
    if (typeof token !== "string" || token.length === 0) {
      throw new AuthError("unauthenticated", "missing bearer token");
    }
    const kind = tokenKindOf(token);
    if (!kind) throw new AuthError("unauthenticated", "unrecognized token");

    const record = await this.storage.getTokenByHash(hashToken(token));
    if (!record) throw new AuthError("unauthenticated", "invalid token");
    if (record.kind !== kind) throw new AuthError("unauthenticated", "invalid token");
    if (record.revokedAt) throw new AuthError("unauthenticated", "token revoked");
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= this.now()) {
      throw new AuthError("unauthenticated", "token expired");
    }

    const user = await this.storage.getUserById(record.tenantId, record.userId);
    if (!user) throw new AuthError("unauthenticated", "invalid token");
    if (user.status !== "active") throw new AuthError("user_suspended", "this account is suspended");

    const tenant = await this.storage.getTenantById(user.tenantId);
    if (!tenant) throw new AuthError("unauthenticated", "invalid token");
    if (tenant.status !== "active") throw new AuthError("tenant_suspended", "this workspace is suspended");

    await this.storage.touchToken(record.tokenHash, this.nowIso());

    return {
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
      tokenKind: record.kind,
      tokenId: record.id,
    };
  }

  /** Revoke the token that backs the given context (logout). */
  async logout(token: string): Promise<void> {
    if (typeof token !== "string" || token.length === 0) return;
    await this.storage.revokeToken(hashToken(token));
  }

  /** Mint a long-lived API token for the caller's own account (CLI/agent auth). */
  async createApiToken(ctx: AuthContext, label = "api"): Promise<AuthResult> {
    const user = await this.storage.getUserById(ctx.tenantId, ctx.userId);
    if (!user) throw new AuthError("not_found", "user not found");
    const issued = await this.issueToken(user, "api", label.slice(0, 120));
    const tenant = await this.storage.getTenantById(user.tenantId);
    if (!tenant) throw new AuthError("not_found", "tenant not found");
    return {
      user: toPublicUser(user),
      tenant,
      token: issued.token,
      tokenKind: "api",
      expiresAt: issued.record.expiresAt,
    };
  }

  /** List the caller's own live tokens (metadata only — never plaintext or hashes-as-secrets). */
  async listMyTokens(ctx: AuthContext): Promise<Omit<Token, "tokenHash">[]> {
    const tokens = await this.storage.listUserTokens(ctx.tenantId, ctx.userId);
    return tokens.map(({ tokenHash: _h, ...rest }) => rest);
  }

  // --- Tenant-scoped admin (owner/admin within the tenant) ---

  private assertTenantAdmin(ctx: AuthContext): void {
    if (ctx.isSuperAdmin) return;
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new AuthError("forbidden", "requires tenant owner or admin");
    }
  }

  /** Users within the caller's tenant. Super admins may target any tenant via `tenantId`. */
  async listTenantUsers(ctx: AuthContext, tenantId?: string): Promise<PublicUser[]> {
    const target = this.resolveTenantScope(ctx, tenantId);
    const users = await this.storage.listUsers(target);
    return users.map(toPublicUser);
  }

  private resolveTenantScope(ctx: AuthContext, tenantId?: string): string {
    if (!tenantId || tenantId === ctx.tenantId) return ctx.tenantId;
    // Only super admins may read across the tenant boundary.
    if (!ctx.isSuperAdmin) throw new AuthError("forbidden", "cross-tenant access denied");
    return tenantId;
  }

  async setUserRole(ctx: AuthContext, userId: string, role: TenantRole): Promise<PublicUser> {
    this.assertTenantAdmin(ctx);
    const updated = await this.storage.setUserRole(ctx.tenantId, userId, role);
    if (!updated) throw new AuthError("not_found", "user not found in this tenant");
    return toPublicUser(updated);
  }

  async suspendTenantUser(ctx: AuthContext, userId: string): Promise<PublicUser> {
    this.assertTenantAdmin(ctx);
    const updated = await this.storage.setUserStatus(ctx.tenantId, userId, "suspended");
    if (!updated) throw new AuthError("not_found", "user not found in this tenant");
    await this.storage.revokeAllUserTokens(ctx.tenantId, userId);
    return toPublicUser(updated);
  }

  // --- Super-admin plane (andrei@hasna.com) — crosses tenants ---

  private assertSuperAdmin(ctx: AuthContext): void {
    if (!ctx.isSuperAdmin) throw new AuthError("forbidden", "requires super administrator");
  }

  async listAllTenants(ctx: AuthContext): Promise<Tenant[]> {
    this.assertSuperAdmin(ctx);
    return this.storage.listTenantsGlobal();
  }

  async listAllUsers(ctx: AuthContext): Promise<PublicUser[]> {
    this.assertSuperAdmin(ctx);
    const users = await this.storage.listUsersGlobal();
    return users.map(toPublicUser);
  }

  async setTenantStatus(ctx: AuthContext, tenantId: string, status: "active" | "suspended"): Promise<Tenant> {
    this.assertSuperAdmin(ctx);
    const updated = await this.storage.setTenantStatus(tenantId, status);
    if (!updated) throw new AuthError("not_found", "tenant not found");
    return updated;
  }
}
