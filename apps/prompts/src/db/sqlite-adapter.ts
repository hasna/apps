import { Database } from "bun:sqlite"

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

function normalizeParams(params: unknown[]): unknown[] {
  return params.length === 1 && Array.isArray(params[0]) ? params[0] : params
}

export class SqliteAdapter {
  readonly raw: Database

  constructor(path: string) {
    this.raw = new Database(path, { create: true })
    this.raw.exec("PRAGMA journal_mode = WAL")
    this.raw.exec("PRAGMA foreign_keys = ON")
  }

  run(sql: string, ...params: unknown[]): RunResult {
    const result = this.raw.prepare(sql).run(...normalizeParams(params) as any[])
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  }

  get(sql: string, ...params: unknown[]): unknown {
    return this.raw.prepare(sql).get(...normalizeParams(params) as any[])
  }

  all(sql: string, ...params: unknown[]): unknown[] {
    return this.raw.prepare(sql).all(...normalizeParams(params) as any[])
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  query(sql: string) {
    return this.raw.query(sql)
  }

  prepare(sql: string) {
    return this.raw.prepare(sql)
  }

  close(): void {
    this.raw.close()
  }
}
