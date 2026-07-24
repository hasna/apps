import type { Database } from "bun:sqlite";
import {
  isTodosShadowEnabled,
  resolveTodosStorageRole,
  type TodosStorageEnv,
} from "./config.js";
import {
  assertTodosStageARemoteAccessFloor,
  TodosHostedStorageUnavailableError,
} from "./authority-floor.js";
import type { TodosCloudQueryClient } from "./cloud-client.js";
import {
  TodosShadowOutbox,
  installShadowOutboxSchema,
} from "./shadow-outbox.js";

/**
 * Stage-A runtime glue. Explicit local mode may install durable SQLite capture,
 * but all automatic remote construction, draining, pushing, and exit flushing
 * is disabled until a trusted authority resolver exists.
 */

let _capturedDb: Database | null = null;
let _outbox: TodosShadowOutbox | null = null;
let _cloud: TodosCloudQueryClient | null = null;

export interface RuntimeShadowDependencies {
  createCloudClient?: (env: TodosStorageEnv) => TodosCloudQueryClient | null;
}

/**
 * Install durable capture triggers if the shadow is enabled. Pure SQLite, never
 * throws for cloud-config reasons, never keeps the process alive. Idempotent.
 */
export function maybeInstallShadowCapture(db: Database, env: TodosStorageEnv = process.env): boolean {
  const processRole = resolveTodosStorageRole(process.env);
  if (processRole.role !== "local") {
    throw new TodosHostedStorageUnavailableError(processRole.reason);
  }
  if (!isTodosShadowEnabled(env)) return false;
  if (resolveTodosStorageRole(env).role !== "local") return false;
  if (_capturedDb === db) return true;
  installShadowOutboxSchema(db);
  _capturedDb = db;
  return true;
}

/**
 * Stage-A remote-drain floor. Capture remains local; no outbox client is built.
 */
export function getRuntimeShadowOutbox(
  _db: Database,
  _env: TodosStorageEnv = process.env,
  _dependencies: RuntimeShadowDependencies = {},
): TodosShadowOutbox {
  return assertTodosStageARemoteAccessFloor();
}

/**
 * Preserve local capture without starting a background remote drain.
 */
export function startRuntimeShadowDrain(
  db: Database,
  env: TodosStorageEnv = process.env,
  dependencies: RuntimeShadowDependencies = {},
): void {
  const processRole = resolveTodosStorageRole(process.env);
  if (processRole.role !== "local") {
    throw new TodosHostedStorageUnavailableError(processRole.reason);
  }
  if (!isTodosShadowEnabled(env)) return;
  void dependencies;
  // Explicit local mode may keep durable SQLite capture. Stage A deliberately
  // performs no automatic remote construction, drain, push, or exit flush.
  maybeInstallShadowCapture(db, env);
}

/**
 * Stage-A no-op retained as an API-compatible rollback floor.
 */
export function registerShadowExitFlush(db: Database, env: TodosStorageEnv = process.env): void {
  void db;
  void env;
  // Stage A floor: automatic process-exit flushing is disabled.
}

/** Refuse every explicit remote shadow command until trusted authority exists. */
export function assertRuntimeShadowRemoteAccessDisabled(
  _env: TodosStorageEnv = process.env,
): never {
  return assertTodosStageARemoteAccessFloor();
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
}
