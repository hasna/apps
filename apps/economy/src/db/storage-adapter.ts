import { Database as BunDatabase } from 'bun:sqlite'

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface PreparedStatement {
  run(...params: any[]): RunResult
  get(...params: any[]): unknown
  all(...params: any[]): unknown[]
  finalize(): void
}

export interface DbAdapter {
  run(sql: string, ...params: any[]): RunResult
  get(sql: string, ...params: any[]): unknown
  all(sql: string, ...params: any[]): unknown[]
  exec(sql: string): void
  prepare(sql: string): PreparedStatement
  close(): void
  transaction<T>(fn: () => T): T
}

export class SqliteAdapter implements DbAdapter {
  private readonly db: BunDatabase

  constructor(path: string) {
    this.db = new BunDatabase(path, { create: true })
  }

  run(sql: string, ...params: any[]): RunResult {
    const result = this.db.prepare(sql).run(...params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }

  get(sql: string, ...params: any[]): unknown {
    return this.db.prepare(sql).get(...params)
  }

  all(sql: string, ...params: any[]): unknown[] {
    return this.db.prepare(sql).all(...params) as unknown[]
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  query(sql: string): unknown {
    return this.db.query(sql)
  }

  prepare(sql: string): PreparedStatement {
    const statement = this.db.prepare(sql)
    return {
      run(...params: any[]): RunResult {
        const result = statement.run(...params)
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
      },
      get(...params: any[]): unknown {
        return statement.get(...params)
      },
      all(...params: any[]): unknown[] {
        return statement.all(...params) as unknown[]
      },
      finalize(): void {
        statement.finalize()
      },
    }
  }

  close(): void {
    this.db.close()
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  get raw(): BunDatabase {
    return this.db
  }
}
