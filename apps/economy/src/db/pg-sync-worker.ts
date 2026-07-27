// Worker backing `SyncPgAdapter`. Runs Postgres queries on its own event loop
// so the MAIN thread can block on `Atomics.wait` for a synchronous result
// without deadlocking pg's async socket IO (the flaw that makes any in-thread
// sync-over-async PG client time out under Bun). Request in via `parentPort`; result
// out via a transferred `MessagePort` the main thread drains with
// `receiveMessageOnPort` after it wakes.
import { parentPort, workerData } from 'node:worker_threads'
import pg from 'pg'

// The economy query layer (written for bun:sqlite) expects COUNT/SUM to be JS
// numbers. node-pg returns int8 (OID 20) and numeric (OID 1700) as strings,
// which turns `count + count` into string concatenation ("0"+"0"="00"). Parse
// them back to numbers so aggregate math matches the SQLite path. (Precision
// parity with the original bun:sqlite path, which also used JS numbers.)
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)))
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))

interface QueryMessage {
  type?: undefined
  id: number
  sql: string
  params: unknown[]
  signal: SharedArrayBuffer
}
interface InitMessage {
  type: 'init'
  port: MessagePort
}

const dsn: string = (workerData as { dsn: string })?.dsn
const ssl = dsn && (dsn.includes('sslmode=require') || dsn.includes('ssl=true')) ? { rejectUnauthorized: false } : undefined
const pool = new pg.Pool({
  connectionString: dsn,
  ssl,
  max: Number(process.env['ECONOMY_PG_POOL_MAX'] ?? '5'),
  connectionTimeoutMillis: 10_000,
})
pool.on('error', (err: Error) => {
  // Idle backend dropped — pg reconnects on the next query. Swallow so the
  // worker never crashes the process.
  console.error(JSON.stringify({ evt: 'pg_worker_pool_error', message: err.message }))
})

let replyPort: MessagePort | null = null

parentPort?.on('message', (msg: QueryMessage | InitMessage) => {
  if ((msg as InitMessage).type === 'init') {
    replyPort = (msg as InitMessage).port
    return
  }
  const { id, sql, params, signal } = msg as QueryMessage
  const sig = new Int32Array(signal)
  void pool
    .query(sql, params)
    .then((res) => ({ id, ok: true as const, rows: res.rows, rowCount: res.rowCount ?? 0 }))
    .catch((err: unknown) => ({ id, ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    .then((response) => {
      replyPort?.postMessage(response)
      // Wake the blocked main thread AFTER the reply is enqueued on the port.
      Atomics.store(sig, 0, 1)
      Atomics.notify(sig, 0)
    })
})
