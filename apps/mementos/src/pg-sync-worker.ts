/**
 * Postgres synchronous-bridge worker (server postgresql backend).
 *
 * The mementos data layer is fully synchronous: every CLI/MCP/server call site
 * does `db.query(sql).get(...)`. node-postgres is async and its socket I/O is
 * driven by the event loop, so a busy-wait on the main thread (Bun.sleepSync)
 * deadlocks — the loop never advances the pending query.
 *
 * This worker owns a single long-lived `pg.Client` and processes queries on its
 * OWN event loop (via `parentPort` message events), so pg I/O completes
 * normally. The main thread posts a request then blocks on `Atomics.wait`
 * against a SharedArrayBuffer until this worker writes the response back into a
 * shared data buffer and flips the status word. One client (not a pool) keeps
 * transactions (BEGIN/COMMIT/ROLLBACK) correct since all statements are
 * serialized over the single connection.
 *
 * Every request carries a `gen` generation token, which the response echoes
 * into status[0]. A caller whose query timed out has abandoned it, but this
 * worker still finishes it and writes the response — the generation lets the
 * caller recognize that late response and discard it instead of letting the
 * next query consume it.
 */
import { parentPort, workerData } from "node:worker_threads";
import pg from "pg";

// Postgres returns int8/BIGINT values — including COUNT()/SUM() aggregates —
// as strings by default (node-pg avoids precision loss for true 64-bit ints).
// Every analytics/count surface in this codebase treats those values as JS
// numbers (e.g. `rows.reduce((s, r) => s + r.memories_created, 0)`), so without
// this the sums *string-concatenate* into garbage — the `report` "Recent"
// count came back as "05361123794747 new / ~670140474343/day". The schema has
// no true bigint columns (ids are text/uuid, counters are int4/SERIAL), so
// coercing OID 20 (int8) to a JS number only affects aggregate results and is
// safe. Set on the worker's pg module, which owns the server's only live
// client.
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10));

interface WorkerData {
  dsn: string;
  ssl: boolean | { rejectUnauthorized: boolean } | undefined;
  control: SharedArrayBuffer;
  data: SharedArrayBuffer;
}

const { dsn, ssl, control, data } = workerData as WorkerData;
const status = new Int32Array(control); // [0]=responding generation (0 idle), [1]=byteLength, [2]=status code (1 ok, 2 err)
const dataView = new Uint8Array(data);
const encoder = new TextEncoder();

const client = new pg.Client({ connectionString: dsn, ssl });
let connected = false;
let connecting: Promise<void> | null = null;

async function ensureConnected(): Promise<void> {
  if (connected) return;
  if (!connecting) {
    connecting = client.connect().then(() => {
      connected = true;
    });
  }
  await connecting;
}

/**
 * Write a response tagged with the request's `gen` generation. The payload
 * lands in the shared data buffer first, then the length, then the status
 * code, and finally the generation — the caller only reads the payload after
 * observing status[0] === its own gen, so the data/len/code writes are all
 * visible (Atomics stores are sequentially consistent).
 */
function respond(gen: number, statusCode: number, payload: unknown): void {
  const bytes = encoder.encode(JSON.stringify(payload));
  if (bytes.length > dataView.length) {
    const errBytes = encoder.encode(
      JSON.stringify({
        message: `PgSyncWorker: response of ${bytes.length} bytes exceeds shared buffer (${dataView.length})`,
      })
    );
    dataView.set(errBytes, 0);
    Atomics.store(status, 1, errBytes.length);
    Atomics.store(status, 2, 2);
    Atomics.store(status, 0, gen);
    Atomics.notify(status, 0);
    return;
  }
  dataView.set(bytes, 0);
  Atomics.store(status, 1, bytes.length);
  Atomics.store(status, 2, statusCode);
  Atomics.store(status, 0, gen);
  Atomics.notify(status, 0);
}

parentPort?.on(
  "message",
  async (msg: { sql: string; params: unknown[]; gen: number }) => {
    try {
      await ensureConnected();
      const result = await client.query(msg.sql, msg.params as unknown[]);
      respond(msg.gen, 1, { rows: result.rows, rowCount: result.rowCount });
    } catch (error) {
      respond(msg.gen, 2, { message: error instanceof Error ? error.message : String(error) });
    }
  }
);
