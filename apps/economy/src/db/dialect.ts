// SQLite -> PostgreSQL statement translator.
//
// `database.ts` is written once, in SQLite-flavored SQL, and runs unchanged in
// both storage modes. In self-hosted (Postgres) mode `SyncPgAdapter` pushes
// every statement through `translateSql` here first. This is a faithful port of
// the translator economy has always run against production RDS — the rewrite
// list and its ORDER are behaviour, not style; do not reorder them.
//
// Scope is deliberately closed: only the idioms economy's query layer actually
// emits. Date/time idioms are handled separately and afterwards, by
// `translateSqliteDates` in sync-pg.ts.

export type Dialect = 'sqlite' | 'pg'

/**
 * Translate SQLite-flavored SQL to PostgreSQL.
 * When `dialect` is "sqlite", returns the SQL unchanged.
 */
export function translateSql(sql: string, dialect: Dialect): string {
  if (dialect === 'sqlite') return sql
  return sqliteToPostgres(sql)
}

/**
 * Flatten params for PG — bun:sqlite accepts either variadic params or a single
 * array; pg always wants a flat array. Also maps `undefined` -> `null`, which pg
 * would otherwise reject.
 */
export function translateParams(params: any[]): any[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params
  return flat.map((p) => (p === undefined ? null : p))
}

function sqliteToPostgres(sql: string): string {
  let out = sql

  // Positional placeholders: ? -> $1, $2, ...
  let paramIdx = 0
  out = out.replace(/\?/g, () => `$${++paramIdx}`)

  // datetime('now') and datetime('now', '<signed n> <unit>')
  out = out.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()')
  out = out.replace(
    /datetime\s*\(\s*'now'\s*,\s*'(-?\d+)\s+(minutes?|hours?|days?|seconds?)'\s*\)/gi,
    (_match, amount: string, unit: string) => {
      const n = parseInt(amount, 10)
      const absN = Math.abs(n)
      const normalizedUnit = unit.toLowerCase().replace(/s$/, '')
      const plural = absN === 1 ? normalizedUnit : `${normalizedUnit}s`
      return n < 0 ? `NOW() - INTERVAL '${absN} ${plural}'` : `NOW() + INTERVAL '${absN} ${plural}'`
    },
  )

  out = out.replace(/lower\s*\(\s*hex\s*\(\s*randomblob\s*\(\s*\d+\s*\)\s*\)\s*\)/gi, 'gen_random_uuid()::text')
  out = out.replace(/GROUP_CONCAT\s*\(/gi, 'STRING_AGG(')
  out = out.replace(
    /json_extract\s*\(\s*(\w+)\s*,\s*'\$\.(\w+)'\s*\)/gi,
    (_match, col: string, key: string) => `${col}->>'${key}'`,
  )
  out = out.replace(/\bAUTOINCREMENT\b/gi, 'GENERATED ALWAYS AS IDENTITY')
  // LIKE -> ILIKE (SQLite LIKE is case-insensitive for ASCII; PG LIKE is not).
  // The lookbehind keeps an already-rewritten ILIKE from becoming IILIKE.
  out = out.replace(/(?<![I])LIKE/gi, 'ILIKE')
  out = out.replace(/\bIFNULL\s*\(/gi, 'COALESCE(')

  // `INSERT OR REPLACE` has no Postgres equivalent that is safe to synthesise
  // here (the conflict target is not knowable from the statement text), so it
  // degrades to a bare INSERT. Callers that need re-runnable writes against PG
  // must emit an explicit `ON CONFLICT (...) DO UPDATE` themselves — see the
  // bulk-ingest path in database.ts.
  out = out.replace(
    /INSERT\s+OR\s+REPLACE\s+INTO\s+"?(\w+)"?\s*\(([^)]+)\)\s*VALUES/gi,
    (_match, table: string, colList: string) => `INSERT INTO "${table}" (${colList}) VALUES`,
  )
  out = out.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO')

  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
    out = out.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING')
  }

  return out
}
