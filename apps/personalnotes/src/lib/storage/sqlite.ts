import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Tenant, TenantStatus, Token, TokenKind, User, UserStatus } from "../tenancy/types.js";
import type { AuthStorage } from "./contract.js";

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  is_super_admin: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface TokenRow {
  id: string;
  tenant_id: string;
  user_id: string;
  kind: string;
  token_hash: string;
  label: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Ordered, additive migrations. NEVER edit a released statement — append a new one. */
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS pn_tenants (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pn_users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES pn_tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'member',
        is_super_admin INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pn_users_tenant_idx ON pn_users(tenant_id);
      CREATE TABLE IF NOT EXISTS pn_tokens (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES pn_tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES pn_users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS pn_tokens_user_idx ON pn_tokens(tenant_id, user_id);
    `,
  },
];

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status as TenantStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    role: row.role as User["role"],
    isSuperAdmin: row.is_super_admin === 1,
    status: row.status as UserStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapToken(row: TokenRow): Token {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    kind: row.kind as TokenKind,
    tokenHash: row.token_hash,
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export interface SqliteAuthStorageOptions {
  /** File path, or ":memory:" for an ephemeral store (tests). */
  path: string;
}

export class SqliteAuthStorage implements AuthStorage {
  readonly backend = "sqlite" as const;
  private readonly db: Database;

  constructor(options: SqliteAuthStorageOptions) {
    if (options.path !== ":memory:") {
      mkdirSync(dirname(options.path), { recursive: true });
    }
    this.db = new Database(options.path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS pn_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );`,
    );
  }

  async migrate(opts: { dryRun?: boolean } = {}): Promise<{ applied: string[]; pending: string[] }> {
    const done = new Set(
      this.db.query<{ id: string }, []>("SELECT id FROM pn_schema_migrations").all().map((r) => r.id),
    );
    const pending = MIGRATIONS.filter((m) => !done.has(m.id)).map((m) => m.id);
    if (opts.dryRun) return { applied: [], pending };

    const applied: string[] = [];
    for (const migration of MIGRATIONS) {
      if (done.has(migration.id)) continue;
      const tx = this.db.transaction(() => {
        this.db.exec(migration.sql);
        this.db.query("INSERT INTO pn_schema_migrations (id, applied_at) VALUES (?, ?)").run(
          migration.id,
          new Date().toISOString(),
        );
      });
      tx();
      applied.push(migration.id);
    }
    return { applied, pending: [] };
  }

  // --- Tenants ---
  async createTenant(input: Omit<Tenant, "createdAt" | "updatedAt">): Promise<Tenant> {
    const now = new Date().toISOString();
    this.db
      .query(
        "INSERT INTO pn_tenants (id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(input.id, input.slug, input.name, input.status, now, now);
    return { ...input, createdAt: now, updatedAt: now };
  }

  async getTenantById(id: string): Promise<Tenant | null> {
    const row = this.db.query<TenantRow, [string]>("SELECT * FROM pn_tenants WHERE id = ?").get(id);
    return row ? mapTenant(row) : null;
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const row = this.db.query<TenantRow, [string]>("SELECT * FROM pn_tenants WHERE slug = ?").get(slug);
    return row ? mapTenant(row) : null;
  }

  async setTenantStatus(id: string, status: TenantStatus): Promise<Tenant | null> {
    const now = new Date().toISOString();
    this.db.query("UPDATE pn_tenants SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
    return this.getTenantById(id);
  }

  async listTenantsGlobal(): Promise<Tenant[]> {
    return this.db
      .query<TenantRow, []>("SELECT * FROM pn_tenants ORDER BY created_at ASC")
      .all()
      .map(mapTenant);
  }

  // --- Users ---
  async createUser(input: Omit<User, "createdAt" | "updatedAt">): Promise<User> {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO pn_users
          (id, tenant_id, email, password_hash, display_name, role, is_super_admin, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.tenantId,
        input.email,
        input.passwordHash,
        input.displayName,
        input.role,
        input.isSuperAdmin ? 1 : 0,
        input.status,
        now,
        now,
      );
    return { ...input, createdAt: now, updatedAt: now };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const row = this.db.query<UserRow, [string]>("SELECT * FROM pn_users WHERE email = ?").get(email);
    return row ? mapUser(row) : null;
  }

  async getUserById(tenantId: string, id: string): Promise<User | null> {
    const row = this.db
      .query<UserRow, [string, string]>("SELECT * FROM pn_users WHERE id = ? AND tenant_id = ?")
      .get(id, tenantId);
    return row ? mapUser(row) : null;
  }

  async listUsers(tenantId: string): Promise<User[]> {
    return this.db
      .query<UserRow, [string]>("SELECT * FROM pn_users WHERE tenant_id = ? ORDER BY created_at ASC")
      .all(tenantId)
      .map(mapUser);
  }

  async setUserStatus(tenantId: string, id: string, status: UserStatus): Promise<User | null> {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE pn_users SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(status, now, id, tenantId);
    return this.getUserById(tenantId, id);
  }

  async setUserRole(tenantId: string, id: string, role: User["role"]): Promise<User | null> {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE pn_users SET role = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(role, now, id, tenantId);
    return this.getUserById(tenantId, id);
  }

  async updatePassword(tenantId: string, id: string, passwordHash: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE pn_users SET password_hash = ?, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .run(passwordHash, now, id, tenantId);
  }

  async getUserByIdGlobal(id: string): Promise<User | null> {
    const row = this.db.query<UserRow, [string]>("SELECT * FROM pn_users WHERE id = ?").get(id);
    return row ? mapUser(row) : null;
  }

  async listUsersGlobal(): Promise<User[]> {
    return this.db
      .query<UserRow, []>("SELECT * FROM pn_users ORDER BY created_at ASC")
      .all()
      .map(mapUser);
  }

  // --- Tokens ---
  async createToken(input: Omit<Token, "createdAt" | "lastUsedAt" | "revokedAt">): Promise<Token> {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO pn_tokens
          (id, tenant_id, user_id, kind, token_hash, label, created_at, expires_at, last_used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(input.id, input.tenantId, input.userId, input.kind, input.tokenHash, input.label, now, input.expiresAt);
    return { ...input, createdAt: now, lastUsedAt: null, revokedAt: null };
  }

  async getTokenByHash(tokenHash: string): Promise<Token | null> {
    const row = this.db
      .query<TokenRow, [string]>("SELECT * FROM pn_tokens WHERE token_hash = ?")
      .get(tokenHash);
    return row ? mapToken(row) : null;
  }

  async touchToken(tokenHash: string, when: string): Promise<void> {
    this.db.query("UPDATE pn_tokens SET last_used_at = ? WHERE token_hash = ?").run(when, tokenHash);
  }

  async revokeToken(tokenHash: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .query("UPDATE pn_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(now, tokenHash);
  }

  async revokeAllUserTokens(tenantId: string, userId: string): Promise<number> {
    const now = new Date().toISOString();
    const res = this.db
      .query(
        "UPDATE pn_tokens SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL",
      )
      .run(now, tenantId, userId);
    return Number(res.changes ?? 0);
  }

  async listUserTokens(tenantId: string, userId: string): Promise<Token[]> {
    return this.db
      .query<TokenRow, [string, string]>(
        "SELECT * FROM pn_tokens WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC",
      )
      .all(tenantId, userId)
      .map(mapToken);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
