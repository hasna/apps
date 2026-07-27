// Cloud (PURE REMOTE, Amendment A1) storage path for economy-serve.
//
// The self-hosted service reads AND writes the shared RDS Postgres directly.
// There is NO local SQLite, NO cache-as-mode, and NO sync engine in the serve
// process. The core query layer in `database.ts` is dialect-agnostic (it only
// uses the `DbAdapter` surface: prepare/all/get/run/exec/transaction), so the
// same functions run unchanged against the `SyncPgAdapter`, which translates
// SQLite-flavored SQL to Postgres and executes it synchronously against a pooled
// connection.
import type { AuthQueryClient } from '@hasna/contracts/auth'
import pg from 'pg'
import type { DbAdapter, SqliteAdapter as Database } from './sqlite-adapter.js'
import { SyncPgAdapter } from './sync-pg.js'
import { resolvePgSsl } from './pg-migrate.js'
import { PG_MIGRATIONS } from './pg-migrations.js'

/** Resolve the cloud Postgres DSN from the standard env aliases. */
export function getCloudDatabaseUrl(): string | undefined {
  return (
    process.env['HASNA_ECONOMY_DATABASE_URL']?.trim() ||
    process.env['ECONOMY_DATABASE_URL']?.trim() ||
    process.env['DATABASE_URL']?.trim() ||
    undefined
  )
}

/** True when the serve should run in cloud (RDS-direct) mode. */
export function isCloudMode(): boolean {
  const mode = process.env['HASNA_ECONOMY_STORAGE_MODE']?.trim().toLowerCase()
  if (mode === 'cloud') return true
  if (mode === 'local') return false
  return Boolean(getCloudDatabaseUrl())
}

/** HMAC signing secret for API-key verification (server-held, never in a token). */
export function resolveSigningSecret(): string | undefined {
  return (
    process.env['HASNA_ECONOMY_API_SIGNING_KEY']?.trim() ||
    process.env['HASNA_API_SIGNING_KEY']?.trim() ||
    process.env['API_KEY_SIGNING_SECRET']?.trim() ||
    undefined
  )
}

/**
 * Open a pooled Postgres connection to the shared RDS. Returns a value typed as
 * the SQLite `Database` the query layer expects — safe because `SyncPgAdapter`
 * implements the identical `DbAdapter` surface those functions rely on.
 */
export function openCloudDatabase(dsn = getCloudDatabaseUrl()): Database {
  if (!dsn) {
    throw new Error(
      'economy cloud mode requires a Postgres DSN: set HASNA_ECONOMY_DATABASE_URL (or ECONOMY_DATABASE_URL / DATABASE_URL)',
    )
  }
  // SyncPgAdapter: a worker-backed synchronous PG client (see sync-pg.ts). An
  // in-thread sync-over-async PG client deadlocks pg's async IO under Bun.
  return new SyncPgAdapter(dsn) as unknown as Database
}

/** A raw pg Pool for auxiliary async work (API-key store, migrations). */
export function createCloudPool(dsn = getCloudDatabaseUrl()): pg.Pool {
  if (!dsn) throw new Error('economy cloud mode requires a Postgres DSN (HASNA_ECONOMY_DATABASE_URL)')
  const pool = new pg.Pool({ connectionString: dsn, ssl: resolvePgSsl(dsn), max: Number(process.env['ECONOMY_PG_POOL_MAX'] ?? '5'), connectionTimeoutMillis: 10_000 })
  // Idle backends can drop (RDS failover, network blips, idle timeouts). Without
  // a listener, pg re-emits that as an uncaught 'error' and crashes the process.
  // Swallow it: the pool discards the dead client and dials a fresh one on the
  // next query, so the service self-heals instead of exiting.
  pool.on('error', (err: Error) => {
    console.error(JSON.stringify({ evt: 'pg_pool_error', message: err.message }))
  })
  return pool
}

/**
 * Adapt a pg Pool to the `@hasna/contracts/auth` `AuthQueryClient` surface
 * (many/get/execute). This backs the `ApiKeyStore` without pulling in the
 * generic vendored kit — economy's storage is this pg pool.
 */
export function authClientFromPool(pool: pg.Pool): AuthQueryClient {
  return {
    async many<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const res = await pool.query(sql, params as unknown[])
      return res.rows as T[]
    },
    async get<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      const res = await pool.query(sql, params as unknown[])
      return (res.rows[0] as T) ?? null
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
      await pool.query(sql, params as unknown[])
    },
  }
}

/** Ordered PG migrations applied by the migration runner (index = version). */
export function cloudMigrations(): string[] {
  return PG_MIGRATIONS
}

export type { DbAdapter }
