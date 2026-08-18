/**
 * Harness for the live-PostgreSQL gate declared in hasna.contract.json
 * (storage.pgTestGate).
 *
 * These are the only tests in the repo that open a real Postgres connection.
 * Everything else under src/db mocks or stubs the pool, so it proves nothing
 * about pg-migrate.ts and cloud.ts — the modules that are the entire reason
 * `postgresql` is a declared storage engine.
 *
 * Isolation: each run gets its own schema, scoped through the connection
 * string's libpq `options=-c search_path=…`, so HASNA_ECONOMY_TEST_DATABASE_URL
 * may point at a shared throwaway database without runs colliding, and teardown
 * drops only what the run created.
 *
 * The gate must not be able to pass without a database:
 *   - URL set                                   -> connect for real; an
 *     unreachable database fails the suite.
 *   - URL unset, ECONOMY_REQUIRE_POSTGRES=1     -> throw. The declared gate
 *     command exports that flag, so a vacuous green run is impossible.
 *   - URL unset, flag unset                     -> skip loudly, so `bun run
 *     test` stays green on a machine with no Postgres.
 */

import { describe, it, expect } from 'bun:test'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { applyPgMigrations } from './pg-migrate.js'
import { PG_MIGRATIONS } from './pg-migrations.js'

/** Env var an operator points at a throwaway Postgres to run the gate. */
export const LIVE_PG_URL_ENV = 'HASNA_ECONOMY_TEST_DATABASE_URL'
/** Set to `1` by the declared gate command: a missing database is then a failure, not a skip. */
export const REQUIRE_PG_ENV = 'ECONOMY_REQUIRE_POSTGRES'

export interface LivePgGate {
  /** Connection string for the throwaway database, or null when not supplied. */
  url: string | null
  /** Whether the caller engaged the gate and therefore forbids skipping. */
  required: boolean
}

/**
 * Resolve the gate from an environment. Throws when the gate is engaged but no
 * database was supplied — the failure mode that stops a gate reporting green
 * against nothing.
 */
export function resolveLivePgGate(env: Record<string, string | undefined>): LivePgGate {
  const url = env[LIVE_PG_URL_ENV]?.trim()
  const required = env[REQUIRE_PG_ENV]?.trim() === '1'
  if (url) return { url, required }
  if (required) {
    throw new Error(
      `${REQUIRE_PG_ENV}=1 but ${LIVE_PG_URL_ENV} is unset: the live-PostgreSQL gate declared in ` +
        `hasna.contract.json (storage.pgTestGate) refuses to report a pass without a database.`,
    )
  }
  return { url: null, required }
}

function announceSkip(): void {
  console.warn(
    `[live-pg] SKIPPED — ${LIVE_PG_URL_ENV} is unset, so src/db/pg-migrate.ts and ` +
      `src/db/cloud.ts are NOT covered by this run. Point it at a throwaway Postgres ` +
      `to run the gate declared in hasna.contract.json (storage.pgTestGate).`,
  )
}

export const LIVE_PG_GATE: LivePgGate = resolveLivePgGate(process.env)
if (LIVE_PG_GATE.url === null) announceSkip()

/** True when this process has a database and the live suites should run. */
export const LIVE_PG_ENABLED = LIVE_PG_GATE.url !== null

/** Scope every connection built from this URL to one schema, libpq style. */
export function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  url.searchParams.set('options', `-c search_path=${schema}`)
  return url.toString()
}

/**
 * Run the declared live gate: apply the real economy PG migrations inside an
 * isolated schema, then prove the migrated schema is queryable through the
 * same `pg` dialling economy's server uses.
 */
describe('live PostgreSQL gate (storage.pgTestGate)', () => {
  it('refuses to run when the gate is engaged without a database', () => {
    expect(() => resolveLivePgGate({ [REQUIRE_PG_ENV]: '1' })).toThrow(/refuses to report a pass without a database/)
    expect(() => resolveLivePgGate({})).not.toThrow()
  })

  it.skipIf(!LIVE_PG_ENABLED)('applies PG_MIGRATIONS against the throwaway database and queries it back', async () => {
    const connectionString = LIVE_PG_GATE.url!
    const schema = `econ_gate_${randomBytes(6).toString('hex')}`
    const admin = new pg.Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 10_000,
      applicationName: 'economy-pg-gate-admin',
    })
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const scoped = withSearchPath(connectionString, schema)
      const result = await applyPgMigrations(scoped, PG_MIGRATIONS, 'economy-pg-gate')
      expect(result.applied.length).toBeGreaterThan(0)
      expect(result.errors).toEqual([])

      const pool = new pg.Pool({
        connectionString: scoped,
        max: 2,
        connectionTimeoutMillis: 10_000,
        applicationName: 'economy-pg-gate',
      })
      try {
        const rows = await pool.query('SELECT index FROM _pg_migrations ORDER BY index')
        expect(rows.rowCount).toBe(result.applied.length)
      } finally {
        await pool.end()
      }
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
      await admin.end().catch(() => {})
    }
  })
})
