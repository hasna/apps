// Local SQLite adapter — a thin, synchronous wrapper over `bun:sqlite`.
//
// This is the storage primitive the whole economy query layer is written
// against. It used to be imported from a shared package; it is now owned here,
// because it is ~40 lines of `bun:sqlite` passthrough and a shared package
// bought nothing but a dependency edge.
//
// The `DbAdapter` interface below is the ONLY surface `database.ts` and its
// callers use (run/get/all/exec/prepare/close/transaction). `SyncPgAdapter`
// (sync-pg.ts) implements the same interface, which is what lets the identical
// synchronous query layer run against Postgres in self-hosted mode.
import { Database } from 'bun:sqlite'

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface PreparedStatement {
  run(...params: any[]): RunResult
  get(...params: any[]): any
  all(...params: any[]): any[]
  finalize(): void
}

export interface DbAdapter {
  run(sql: string, ...params: any[]): RunResult
  get(sql: string, ...params: any[]): any
  all(sql: string, ...params: any[]): any[]
  exec(sql: string): void
  prepare(sql: string): PreparedStatement
  close(): void
  transaction<T>(fn: () => T): T
}

export class SqliteAdapter implements DbAdapter {
  private db: Database

  constructor(path: string) {
    this.db = new Database(path, { create: true })
    // Both PRAGMAs are per-connection and BOTH are load-bearing:
    //   journal_mode=WAL  — concurrent readers while the ingest path writes.
    //   foreign_keys=ON   — SQLite defaults this OFF, and with it off every
    //                       `ON DELETE CASCADE` in the schema silently becomes a
    //                       no-op, orphaning child rows with no error at all.
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA foreign_keys=ON')
  }

  run(sql: string, ...params: any[]): RunResult {
    const result = this.db.prepare(sql).run(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }

  get(sql: string, ...params: any[]): any {
    return this.db.prepare(sql).get(...params)
  }

  all(sql: string, ...params: any[]): any[] {
    return this.db.prepare(sql).all(...params)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  /** Passthrough to bun:sqlite's `.query()` for callers that use `db.query()`. */
  query(sql: string) {
    return this.db.query(sql)
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql)
    return {
      run(...params: any[]): RunResult {
        const r = stmt.run(...params)
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
      },
      get(...params: any[]): any {
        return stmt.get(...params)
      },
      all(...params: any[]): any[] {
        return stmt.all(...params)
      },
      finalize(): void {
        stmt.finalize()
      },
    }
  }

  close(): void {
    this.db.close()
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  /** Expose the underlying bun:sqlite Database for advanced usage. */
  get raw(): Database {
    return this.db
  }
}
