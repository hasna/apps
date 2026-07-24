import type { Pool } from "pg";
import type { Tenant, TenantStatus, Token, TokenKind, User, UserStatus } from "../tenancy/types.js";
import type { AuthStorage } from "./contract.js";
import { checksumStorageSql, POSTGRES_STORAGE_MIGRATIONS } from "./postgres-schema.js";

/** 64-bit advisory lock key derived from a fixed namespace string. */
const MIGRATION_LOCK_KEY = 0x504e_4d54; // "PNMT"

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  is_super_admin: boolean;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TokenRow {
  id: string;
  tenant_id: string;
  user_id: string;
  kind: string;
  token_hash: string;
  label: string;
  created_at: Date | string;
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status as TenantStatus,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
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
    isSuperAdmin: row.is_super_admin === true,
    status: row.status as UserStatus,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
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
    createdAt: iso(row.created_at)!,
    expiresAt: iso(row.expires_at),
    lastUsedAt: iso(row.last_used_at),
    revokedAt: iso(row.revoked_at),
  };
}

export interface PostgresAuthStorageOptions {
  pool: Pool;
}

export class PostgresAuthStorage implements AuthStorage {
  readonly backend = "postgres" as const;
  private readonly pool: Pool;

  constructor(options: PostgresAuthStorageOptions) {
    this.pool = options.pool;
  }

  async migrate(opts: { dryRun?: boolean } = {}): Promise<{ applied: string[]; pending: string[] }> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS pn_schema_migrations (
          id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      const doneRows = await client.query<{ id: string; checksum: string }>(
        "SELECT id, checksum FROM pn_schema_migrations",
      );
      const done = new Map(doneRows.rows.map((r) => [r.id, r.checksum]));

      for (const migration of POSTGRES_STORAGE_MIGRATIONS) {
        const checksum = checksumStorageSql(migration.sql);
        const prior = done.get(migration.id);
        if (prior && prior !== checksum) {
          throw new Error(`migration ${migration.id} checksum drift: released SQL must not be edited`);
        }
      }

      const pending = POSTGRES_STORAGE_MIGRATIONS.filter((m) => !done.has(m.id)).map((m) => m.id);
      if (opts.dryRun) return { applied: [], pending };

      const applied: string[] = [];
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
        for (const migration of POSTGRES_STORAGE_MIGRATIONS) {
          if (done.has(migration.id)) continue;
          await client.query(migration.sql);
          await client.query("INSERT INTO pn_schema_migrations (id, checksum) VALUES ($1, $2)", [
            migration.id,
            checksumStorageSql(migration.sql),
          ]);
          applied.push(migration.id);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
      return { applied, pending: [] };
    } finally {
      client.release();
    }
  }

  // --- Tenants ---
  async createTenant(input: Omit<Tenant, "createdAt" | "updatedAt">): Promise<Tenant> {
    const now = new Date().toISOString();
    await this.pool.query(
      "INSERT INTO pn_tenants (id, slug, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)",
      [input.id, input.slug, input.name, input.status, now],
    );
    return { ...input, createdAt: now, updatedAt: now };
  }

  async getTenantById(id: string): Promise<Tenant | null> {
    const res = await this.pool.query<TenantRow>("SELECT * FROM pn_tenants WHERE id = $1", [id]);
    return res.rows[0] ? mapTenant(res.rows[0]) : null;
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const res = await this.pool.query<TenantRow>("SELECT * FROM pn_tenants WHERE slug = $1", [slug]);
    return res.rows[0] ? mapTenant(res.rows[0]) : null;
  }

  async setTenantStatus(id: string, status: TenantStatus): Promise<Tenant | null> {
    const res = await this.pool.query<TenantRow>(
      "UPDATE pn_tenants SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
      [id, status],
    );
    return res.rows[0] ? mapTenant(res.rows[0]) : null;
  }

  async listTenantsGlobal(): Promise<Tenant[]> {
    const res = await this.pool.query<TenantRow>("SELECT * FROM pn_tenants ORDER BY created_at ASC");
    return res.rows.map(mapTenant);
  }

  // --- Users ---
  async createUser(input: Omit<User, "createdAt" | "updatedAt">): Promise<User> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO pn_users
        (id, tenant_id, email, password_hash, display_name, role, is_super_admin, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [
        input.id,
        input.tenantId,
        input.email,
        input.passwordHash,
        input.displayName,
        input.role,
        input.isSuperAdmin,
        input.status,
        now,
      ],
    );
    return { ...input, createdAt: now, updatedAt: now };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const res = await this.pool.query<UserRow>("SELECT * FROM pn_users WHERE email = $1", [email]);
    return res.rows[0] ? mapUser(res.rows[0]) : null;
  }

  async getUserById(tenantId: string, id: string): Promise<User | null> {
    const res = await this.pool.query<UserRow>(
      "SELECT * FROM pn_users WHERE id = $1 AND tenant_id = $2",
      [id, tenantId],
    );
    return res.rows[0] ? mapUser(res.rows[0]) : null;
  }

  async listUsers(tenantId: string): Promise<User[]> {
    const res = await this.pool.query<UserRow>(
      "SELECT * FROM pn_users WHERE tenant_id = $1 ORDER BY created_at ASC",
      [tenantId],
    );
    return res.rows.map(mapUser);
  }

  async setUserStatus(tenantId: string, id: string, status: UserStatus): Promise<User | null> {
    const res = await this.pool.query<UserRow>(
      "UPDATE pn_users SET status = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING *",
      [id, tenantId, status],
    );
    return res.rows[0] ? mapUser(res.rows[0]) : null;
  }

  async setUserRole(tenantId: string, id: string, role: User["role"]): Promise<User | null> {
    const res = await this.pool.query<UserRow>(
      "UPDATE pn_users SET role = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2 RETURNING *",
      [id, tenantId, role],
    );
    return res.rows[0] ? mapUser(res.rows[0]) : null;
  }

  async updatePassword(tenantId: string, id: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      "UPDATE pn_users SET password_hash = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2",
      [id, tenantId, passwordHash],
    );
  }

  async getUserByIdGlobal(id: string): Promise<User | null> {
    const res = await this.pool.query<UserRow>("SELECT * FROM pn_users WHERE id = $1", [id]);
    return res.rows[0] ? mapUser(res.rows[0]) : null;
  }

  async listUsersGlobal(): Promise<User[]> {
    const res = await this.pool.query<UserRow>("SELECT * FROM pn_users ORDER BY created_at ASC");
    return res.rows.map(mapUser);
  }

  // --- Tokens ---
  async createToken(input: Omit<Token, "createdAt" | "lastUsedAt" | "revokedAt">): Promise<Token> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO pn_tokens
        (id, tenant_id, user_id, kind, token_hash, label, created_at, expires_at, last_used_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL)`,
      [input.id, input.tenantId, input.userId, input.kind, input.tokenHash, input.label, now, input.expiresAt],
    );
    return { ...input, createdAt: now, lastUsedAt: null, revokedAt: null };
  }

  async getTokenByHash(tokenHash: string): Promise<Token | null> {
    const res = await this.pool.query<TokenRow>("SELECT * FROM pn_tokens WHERE token_hash = $1", [tokenHash]);
    return res.rows[0] ? mapToken(res.rows[0]) : null;
  }

  async touchToken(tokenHash: string, when: string): Promise<void> {
    await this.pool.query("UPDATE pn_tokens SET last_used_at = $2 WHERE token_hash = $1", [tokenHash, when]);
  }

  async revokeToken(tokenHash: string): Promise<void> {
    await this.pool.query(
      "UPDATE pn_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
      [tokenHash],
    );
  }

  async revokeAllUserTokens(tenantId: string, userId: string): Promise<number> {
    const res = await this.pool.query(
      "UPDATE pn_tokens SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL",
      [tenantId, userId],
    );
    return res.rowCount ?? 0;
  }

  async listUserTokens(tenantId: string, userId: string): Promise<Token[]> {
    const res = await this.pool.query<TokenRow>(
      "SELECT * FROM pn_tokens WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC",
      [tenantId, userId],
    );
    return res.rows.map(mapToken);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
