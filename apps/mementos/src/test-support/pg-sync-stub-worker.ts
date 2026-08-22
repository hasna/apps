/**
 * Hermetic stub for the pg-sync worker protocol, used by `pg-sync-race.test.ts`.
 *
 * Speaks the same SharedArrayBuffer protocol as `pg-sync-worker.ts` but never
 * opens a Postgres connection: every message is answered with a payload that
 * ECHOES the query's own SQL, so a test can assert that a query received ITS
 * response and not a predecessor's. A leading `SLEEP_<ms> ` directive in the
 * SQL delays that response on the worker's event loop — the way a test simulates
 * a slow query whose response lands after the caller has already timed out.
 */
import { parentPort, workerData } from "node:worker_threads";

interface StubWorkerData {
  control: SharedArrayBuffer;
  data: SharedArrayBuffer;
}

const { control, data } = workerData as StubWorkerData;
const status = new Int32Array(control); // [0]=generation, [1]=byteLength, [2]=status code
const dataView = new Uint8Array(data);
const encoder = new TextEncoder();

function respond(gen: number, statusCode: number, payload: unknown): void {
  const bytes = encoder.encode(JSON.stringify(payload));
  if (bytes.length > dataView.length) {
    throw new Error("pg-sync-stub: response exceeds shared buffer");
  }
  dataView.set(bytes, 0);
  Atomics.store(status, 1, bytes.length);
  Atomics.store(status, 2, statusCode);
  Atomics.store(status, 0, gen);
  Atomics.notify(status, 0);
}

parentPort?.on("message", async (msg: { sql: string; gen: number }) => {
  const delay = /^SLEEP_(\d+)\s/.exec(msg.sql);
  if (delay) {
    await new Promise((resolve) => setTimeout(resolve, Number(delay[1])));
  }
  respond(msg.gen, 1, { rows: [{ echoed: msg.sql }], rowCount: 1 });
});
