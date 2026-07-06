// Synchronous Postgres adapter implementing the `@hasna/cloud` `DbAdapter`
// surface the economy query layer relies on (prepare/run/get/all/exec). It runs
// every query on a dedicated worker thread and blocks the main thread on
// `Atomics.wait` for the result, then drains the reply with
// `receiveMessageOnPort`. This is the only way to expose a truly synchronous PG
// client under Bun: an in-thread sync-over-async bridge (Bun.sleepSync polling,
// as in @hasna/cloud's PgAdapter) starves pg's socket IO and always times out.
//
// It lets the entire existing synchronous query layer (database.ts) run
// unchanged against RDS Postgres for the self-hosted serve (Amendment A1: PURE
// REMOTE — direct reads/writes, no cache, no sync engine).
import { Worker, MessageChannel, receiveMessageOnPort, type MessagePort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { translateSql, translateParams, type DbAdapter, type PreparedStatement, type RunResult } from '@hasna/cloud'

type Reply = { id: number; ok: true; rows: Array<Record<string, unknown>>; rowCount: number } | { id: number; ok: false; error: string }

/**
 * Translate the closed set of SQLite date/time idioms the economy query layer
 * uses into Postgres equivalents. Runs AFTER `translateSql` (so `?` are already
 * `$n`). Timestamp columns are stored as ISO-8601 TEXT in both dialects, so bare
 * `DATE(col)` casts through `timestamptz`. Ordered most-specific first.
 */
export function translateSqliteDates(sql: string): string {
  let s = sql
  // The timestamp/started_at/date columns are ISO-8601 TEXT. SQLite `DATE(...)`
  // yields a 'YYYY-MM-DD' string, so we render every DATE(...) as TEXT too — that
  // keeps `text_col >= DATE('now', ...)` comparisons text-vs-text (PG has no
  // implicit text<->date cast). DATETIME(...) comparisons cast to timestamptz.
  const isoDate = (expr: string) => `to_char(${expr}, 'YYYY-MM-DD')`
  // start-of-week (Sunday-based): most recent Sunday <= today
  s = s.replace(/DATE\('now',\s*'weekday 0',\s*'-7 days'\)/gi, isoDate("(date_trunc('week', now() + interval '1 day') - interval '1 day')"))
  // start of month / year
  s = s.replace(/DATE\('now',\s*'start of month'\)/gi, isoDate("date_trunc('month', now())"))
  s = s.replace(/DATE\('now',\s*'start of year'\)/gi, isoDate("date_trunc('year', now())"))
  // 'now' offset by a literal signed number of days/day
  s = s.replace(/DATE\('now',\s*'(-?\d+)\s*days?'\)/gi, (_m, n: string) => isoDate(`now() + interval '${n} days'`))
  // 'now' offset by a bound param:  DATE('now', $k || ' days')
  s = s.replace(/DATE\('now',\s*(\$\d+)\s*\|\|\s*' days'\)/gi, (_m, p: string) => isoDate(`now() + ((${p}) || ' days')::interval`))
  // DATETIME('now', $k) / DATETIME('now', '<literal interval>')  -> timestamptz
  s = s.replace(/DATETIME\('now',\s*(\$\d+)\)/gi, (_m, p: string) => `(now() + (${p})::interval)`)
  s = s.replace(/DATETIME\('now',\s*'([^']+)'\)/gi, (_m, lit: string) => `(now() + interval '${lit}')`)
  // STRFTIME('<fmt>', col) -> to_char(cast, '<pgfmt>') for the tokens economy uses
  const strftimeMap: Record<string, string> = { '%H': 'HH24', '%Y': 'YYYY', '%m': 'MM', '%d': 'DD', '%M': 'MI', '%S': 'SS' }
  s = s.replace(/STRFTIME\('([^']+)',\s*([A-Za-z_][A-Za-z0-9_]*)\)/gi, (_m, fmt: string, col: string) => {
    const pgFmt = Object.entries(strftimeMap).reduce((acc, [k, v]) => acc.split(k).join(v), fmt)
    return `to_char(CAST("${col}" AS timestamptz), '${pgFmt}')`
  })
  // bare 'now'
  s = s.replace(/\bDATE\('now'\)/gi, isoDate('now()'))
  s = s.replace(/\bDATETIME\('now'\)/gi, 'now()')
  // DATE(col) -> first 10 ISO chars (text); DATETIME(col) -> timestamptz cast.
  // Quote the identifier to dodge the `timestamp`/`date` type keywords.
  s = s.replace(/\bDATETIME\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi, (_m, col: string) => `CAST("${col}" AS timestamptz)`)
  s = s.replace(/\bDATE\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/gi, (_m, col: string) => `substr("${col}", 1, 10)`)
  return s
}

function resolveWorkerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'pg-sync-worker.ts'), // dev (bun run src)
    join(here, 'pg-sync-worker.js'), // bundled sibling (dist/server, dist/db)
    join(here, '..', 'db', 'pg-sync-worker.js'),
  ]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  return candidates[0]!
}

export class SyncPgAdapter implements DbAdapter {
  private readonly worker: Worker
  private readonly port: MessagePort
  private counter = 0

  constructor(dsn: string) {
    // Pass the path as a runtime string so the bundler does not try to inline
    // the worker into the serve bundle (it is built as a sibling chunk).
    const workerPath = resolveWorkerPath()
    this.worker = new Worker(workerPath, { workerData: { dsn } })
    this.worker.on('error', (err: Error) => console.error(JSON.stringify({ evt: 'pg_worker_error', message: err.message })))
    const channel = new MessageChannel()
    this.port = channel.port1
    // Transfer port2 to the worker; it posts every reply back on it.
    this.worker.postMessage({ type: 'init', port: channel.port2 }, [channel.port2])
  }

  private query(sql: string, params: unknown[]): { rows: Array<Record<string, unknown>>; rowCount: number } {
    const pgSql = translateSqliteDates(translateSql(sql, 'pg'))
    const pgParams = translateParams(params as unknown[])
    const id = ++this.counter
    const signal = new SharedArrayBuffer(4)
    const sig = new Int32Array(signal)
    Atomics.store(sig, 0, 0)
    this.worker.postMessage({ id, sql: pgSql, params: pgParams, signal })
    // Block until the worker signals completion (returns immediately if the
    // worker already stored 1 before we started waiting).
    Atomics.wait(sig, 0, 0)
    // Drain the reply. It is enqueued before the worker notifies, so it is
    // available synchronously now; spin a bounded number of times to absorb any
    // delivery lag without ever blocking the loop.
    let received = receiveMessageOnPort(this.port)
    for (let attempt = 0; !received && attempt < 1_000_000; attempt++) received = receiveMessageOnPort(this.port)
    if (!received) throw new Error('SyncPgAdapter: no reply from worker')
    const reply = received.message as Reply
    if (!reply.ok) throw new Error(reply.error)
    return { rows: reply.rows, rowCount: reply.rowCount }
  }

  run(sql: string, ...params: unknown[]): RunResult {
    const result = this.query(sql, params)
    return { changes: result.rowCount, lastInsertRowid: (result.rows?.[0]?.['id'] as number | bigint) ?? 0 }
  }
  get(sql: string, ...params: unknown[]): unknown {
    return this.query(sql, params).rows[0] ?? null
  }
  all(sql: string, ...params: unknown[]): unknown[] {
    return this.query(sql, params).rows
  }
  exec(sql: string): void {
    this.query(sql, [])
  }
  prepare(sql: string): PreparedStatement {
    const self = this
    return {
      run: (...params: unknown[]) => self.run(sql, ...params),
      get: (...params: unknown[]) => self.get(sql, ...params),
      all: (...params: unknown[]) => self.all(sql, ...params),
      finalize: () => {},
    }
  }
  transaction<T>(fn: () => T): T {
    // The serve performs no multi-statement transactions; each op is atomic.
    return fn()
  }
  close(): void {
    void this.worker.terminate()
  }
}
