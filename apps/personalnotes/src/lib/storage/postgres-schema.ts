import { createHash } from "node:crypto";

/**
 * PostgreSQL storage migrations, exported so migrators can pull the schema
 * without importing the whole app (hasna-storage-standard). Additive only:
 * NEVER edit a released statement — append a new migration.
 */
export interface PgMigration {
  id: string;
  sql: string;
}

export const POSTGRES_STORAGE_MIGRATIONS: PgMigration[] = [
  {
    id: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS pn_tenants (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pn_users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES pn_tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'member',
        is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pn_users_tenant_idx ON pn_users(tenant_id);
      CREATE TABLE IF NOT EXISTS pn_tokens (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES pn_tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES pn_users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS pn_tokens_user_idx ON pn_tokens(tenant_id, user_id);
    `,
  },
];

export function checksumStorageSql(sql: string): string {
  return createHash("sha256").update(sql.replace(/\s+/g, " ").trim()).digest("hex");
}
