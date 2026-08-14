import type { Database } from "bun:sqlite";
import { isTodosShadowEnabled, getTodosStorageShadowEnvName, getTodosStorageDatabaseEnv, type TodosStorageEnv } from "./config.js";
import { createTodosCloudQueryClientFromEnv, type TodosCloudQueryClient } from "./cloud-client.js";
import {
  TodosShadowOutbox,
  installShadowOutboxSchema,
} from "./shadow-outbox.js";

/**
 * Runtime glue that makes the durable dual-write shadow "real" for every write
 * path. Capture triggers are installed on the shared `getDatabase()` handle so
 * CLI, MCP (stdio + HTTP), and `todos-serve` all enqueue mirror ops without
 * having to route their hundreds of raw-SQL writes through the storage adapter.
 *
 * Draining (the network push to cloud Postgres) is opt-in per process:
 *  - long-running servers call {@link startRuntimeShadowDrain};
 *  - CLI one-shots flush best-effort on exit via {@link registerShadowExitFlush};
 *  - `todos storage shadow-drain` calls {@link getRuntimeShadowOutbox}.
 */

let _capturedDb: Database | null = null;
let _outbox: TodosShadowOutbox | null = null;
let _cloud: TodosCloudQueryClient | null = null;
let _exitRegistered = false;

/**
 * Install durable capture triggers if the shadow is enabled. Pure SQLite, never
 * throws for cloud-config reasons, never keeps the process alive. Idempotent.
 */
export function maybeInstallShadowCapture(db: Database, env: TodosStorageEnv = process.env): boolean {
  if (!isTodosShadowEnabled(env)) return false;
  if (_capturedDb === db) return true;
  installShadowOutboxSchema(db);
  _capturedDb = db;
  return true;
}

/**
 * Build (or reuse) the process-wide shadow outbox bound to `db`. Requires a
 * cloud DSN — throws a clear error if the shadow is enabled without one, rather
 * than silently no-oping. Capture (local durability) does NOT depend on this.
 */
export function getRuntimeShadowOutbox(db: Database, env: TodosStorageEnv = process.env): TodosShadowOutbox {
  if (!isTodosShadowEnabled(env)) {
    throw new Error(
      `dual-write shadow is disabled: set ${getTodosStorageShadowEnvName(env)}=1 to enable it`,
    );
  }
  if (_outbox && _capturedDb === db) return _outbox;
  const cloud = createTodosCloudQueryClientFromEnv(env);
  if (!cloud) {
    throw new Error(
      `dual-write shadow drain requires a remote Postgres DSN in ${getTodosStorageDatabaseEnv(env)}`,
    );
  }
  _cloud = cloud;
  installShadowOutboxSchema(db);
  _capturedDb = db;
  _outbox = new TodosShadowOutbox({ db, postgresClient: cloud });
  return _outbox;
}

/**
 * Start the background drain loop for a long-running process (MCP / serve).
 * Safe no-op when the shadow is disabled. Never throws — a missing DSN or an
 * unreachable cloud simply leaves writes durably queued in the local outbox.
 */
export function startRuntimeShadowDrain(db: Database, env: TodosStorageEnv = process.env): void {
  if (!isTodosShadowEnabled(env)) return;
  // Always install capture, even if draining can't start (writes stay durable).
  maybeInstallShadowCapture(db, env);
  try {
    const outbox = getRuntimeShadowOutbox(db, env);
    outbox.startLoop();
    registerShadowExitFlush(db, env);
  } catch (error) {
    // No DSN / cloud client: capture is live and durable; draining will begin
    // once a DSN is configured. Surface the reason without crashing the server.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[todos] shadow drain not started: ${message}`);
  }
}

/**
 * Best-effort flush of the durable outbox on process exit (CLI one-shots).
 * Registered idempotently; the local writes are already durable regardless.
 */
export function registerShadowExitFlush(db: Database, env: TodosStorageEnv = process.env): void {
  if (_exitRegistered) return;
  if (!isTodosShadowEnabled(env)) return;
  _exitRegistered = true;
  const flush = async () => {
    try {
      const outbox = getRuntimeShadowOutbox(db, env);
      await outbox.flush(5_000);
    } catch {
      // Best effort; durable outbox retries on the next server/drain run.
    } finally {
      await closeRuntimeShadowCloud();
    }
  };
  process.once("beforeExit", () => { void flush(); });
}

export async function closeRuntimeShadowCloud(): Promise<void> {
  if (_cloud) {
    const cloud = _cloud;
    _cloud = null;
    await cloud.close().catch(() => {});
  }
}

/** Test-only reset of the module singletons. */
export function __resetRuntimeShadowForTests(): void {
  if (_outbox) _outbox.stopLoop();
  _capturedDb = null;
  _outbox = null;
  _cloud = null;
  _exitRegistered = false;
}
