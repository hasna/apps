// ── The on-box SQLite lane ────────────────────────────────────────────────────
//
// This is the ONE module in economy's client graph that constructs a
// `bun:sqlite` handle for economy's OWN store, and it exists as a separate
// module for exactly that reason: every client entry point (the `economy` CLI
// and the `economy-mcp` server) reaches it through a GATED DYNAMIC IMPORT taken
// only after the storage seam has already decided that this run is the on-box
// lane (the explicit `HASNA_ECONOMY_LOCAL=1` / `ECONOMY_LOCAL=1` opt-in), or —
// for the hosted `sync` push — to build a throwaway `:memory:` staging handle
// that never touches the filesystem.
//
// Because the import is dynamic and `build:cli` / `build:mcp` run with
// `--splitting`, the SQLite code is emitted into `dist/chunks/` instead of
// `dist/cli/` and `dist/mcp/`: a hosted station's CLI and MCP bundles contain
// no `bun:sqlite` reference at all, and a hosted run never loads this module
// (owner directive 2026-09-04, hasna/apps#1720, fleet-alignment ruling d).
//
// `db/database.ts` — the pure SQL query layer over a handle the caller opens —
// is re-exported here so the on-box lane (and the tests that drive it) has one
// import site, while staying free of `bun:sqlite` itself.
//
// SERVER-SIDE bins (`economy-serve`, `economy-otel`) import this module
// STATICALLY: they are the on-box/server surfaces where the SQLite backend is
// the point, and their bundles are not client bundles.
import { SqliteAdapter as Database } from './sqlite-adapter.js'
import { existsSync, mkdirSync } from 'fs'
import { getDbPath, initSchema } from './database.js'

export * from './database.js'

function isSqliteBusyError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const message = typeof candidate.message === 'string' ? candidate.message : String(error)
  return code === 'SQLITE_BUSY' ||
    code === 'SQLITE_BUSY_RECOVERY' ||
    /database is locked|SQLITE_BUSY/i.test(message)
}

function retryDelayMs(attempt: number): number {
  return Math.min(1000, 50 * (2 ** attempt))
}

function withSqliteBusyRetry<T>(operation: () => T, context: string): T {
  const maxAttempts = 8
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return operation()
    } catch (error) {
      if (!isSqliteBusyError(error)) throw error
      lastError = error
      if (attempt === maxAttempts - 1) break
      Bun.sleepSync(retryDelayMs(attempt))
    }
  }
  throw new Error(
    `SQLite database is locked after ${maxAttempts} attempts while ${context}. Another economy sync/merge may be recovering the database; retry shortly.`,
    { cause: lastError },
  )
}

export function openDatabase(dbPath?: string, skipSeed = false): Database {
  const path = dbPath ?? getDbPath()
  if (path !== ':memory:') {
    const dir = path.substring(0, path.lastIndexOf('/'))
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  const db = withSqliteBusyRetry(() => {
    const opened = new Database(path)
    try {
      opened.exec('PRAGMA busy_timeout = 10000')
      opened.exec('PRAGMA journal_mode = WAL')
      opened.exec('PRAGMA foreign_keys = ON')
      initSchema(opened)
      return opened
    } catch (error) {
      try { opened.close() } catch { /* best effort */ }
      throw error
    }
  }, `opening ${path}`)
  if (!skipSeed) {
    // Lazy import to avoid circular dep — pricing imports db, db seeds pricing
    import('../lib/pricing.js').then(({ ensurePricingSeeded }) => ensurePricingSeeded(db)).catch(() => {})
  }
  return db
}
