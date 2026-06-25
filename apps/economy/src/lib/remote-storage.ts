import pg from 'pg'
import type { Pool, PoolClient } from 'pg'
import type { RunResult } from '../db/storage-adapter.js'

function translatePlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params
  return flat.map((value) => value === undefined ? null : value)
}

function sslConfigFor(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  return connectionString.includes('sslmode=require') || connectionString.includes('ssl=true')
    ? { rejectUnauthorized: false }
    : undefined
}

export class PgAdapterAsync {
  private readonly pool: Pool

  constructor(connectionString: string)
  constructor(pool: Pool)
  constructor(source: string | Pool) {
    this.pool = typeof source === 'string'
      ? new pg.Pool({ connectionString: source, ssl: sslConfigFor(source) })
      : source
  }

  async run(sql: string, ...params: unknown[]): Promise<RunResult> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params))
    return { changes: result.rowCount ?? 0, lastInsertRowid: 0 }
  }

  async get(sql: string, ...params: unknown[]): Promise<unknown> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params))
    return result.rows[0] ?? null
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params))
    return result.rows
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(translatePlaceholders(sql))
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  get raw(): Pool {
    return this.pool
  }
}
