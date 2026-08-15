// Forward-only PostgreSQL migration runner for the self-hosted service.
//
// Applies `PG_MIGRATIONS` (src/db/pg-migrations.ts) index-wise and records each
// applied index in `_pg_migrations`. Index == version, so migrations may only
// ever be appended, never reordered or removed, and each must be idempotent.
// There are no rollbacks.
//
// Invoked by the one-shot deploy migration step: `bun dist/server/index.js migrate`.
import pg from 'pg'

export interface PgMigrationResult {
  service: string
  applied: number[]
  alreadyApplied: number[]
  errors: string[]
  totalMigrations: number
}

/**
 * TLS settings for a Postgres DSN. RDS presents a certificate chain the default
 * Node trust store does not carry, so `sslmode=require`/`ssl=true` DSNs opt into
 * encryption without chain verification — matching how every other economy
 * Postgres connection in this repo is dialled.
 */
export function resolvePgSsl(dsn: string): { rejectUnauthorized: false } | undefined {
  return dsn.includes('sslmode=require') || dsn.includes('ssl=true') ? { rejectUnauthorized: false } : undefined
}

/**
 * Apply an ordered array of SQL migrations to a PostgreSQL database.
 *
 * The statements are executed verbatim: `PG_MIGRATIONS` is already Postgres DDL,
 * so it is NOT passed through the SQLite->PG translator in `dialect.ts` (doing so
 * would be a no-op today — `pg-migrations.test.ts` asserts that — and simply
 * wrong for any future Postgres-native statement).
 *
 * @param connectionString - PG connection string (postgres://...)
 * @param migrations - Ordered array of SQL strings. Index = version number.
 * @param service - Service name for result reporting.
 */
export async function applyPgMigrations(
  connectionString: string,
  migrations: string[],
  service = 'unknown',
): Promise<PgMigrationResult> {
  const pool = new pg.Pool({ connectionString, ssl: resolvePgSsl(connectionString) })
  const result: PgMigrationResult = {
    service,
    applied: [],
    alreadyApplied: [],
    errors: [],
    totalMigrations: migrations.length,
  }

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS _pg_migrations (
        id SERIAL PRIMARY KEY,
        version INT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )`)

    const existing = await pool.query('SELECT version FROM _pg_migrations ORDER BY version')
    const appliedSet = new Set<number>(existing.rows.map((row) => Number(row['version'])))

    for (let i = 0; i < migrations.length; i++) {
      if (appliedSet.has(i)) {
        result.alreadyApplied.push(i)
        continue
      }
      try {
        await pool.query(migrations[i]!)
        await pool.query('INSERT INTO _pg_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [i])
        result.applied.push(i)
      } catch (err) {
        result.errors.push(`Migration ${i}: ${err instanceof Error ? err.message : String(err)}`)
        // Stop at the first failure: later migrations may depend on this one.
        break
      }
    }
  } finally {
    await pool.end().catch(() => {})
  }

  return result
}
