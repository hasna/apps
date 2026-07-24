import { TodosHostedStorageUnavailableError } from "./config.js";
import type {
  CreateShadowTodosStorageAdapterOptions,
  TodosShadowMirror as RemoteTodosShadowMirror,
} from "./shadow.js";
import type {
  CreateTodosShadowOutboxOptions,
  TodosShadowOutbox as RemoteTodosShadowOutbox,
} from "./shadow-outbox.js";
import type { PostgresTodosSyncStore as RemotePostgresTodosSyncStore } from "./postgres-sync.js";

type TodosShadowMirrorPublic = Pick<
  RemoteTodosShadowMirror,
  keyof RemoteTodosShadowMirror
>;
type TodosShadowOutboxPublic = Pick<
  RemoteTodosShadowOutbox,
  keyof RemoteTodosShadowOutbox
>;

const MIRROR_PUBLIC_METHODS = [
  "getMetrics",
  "enqueueUpsert",
  "enqueueDelete",
  "flush",
] as const satisfies readonly (keyof RemoteTodosShadowMirror)[];
const MIRROR_RUNTIME_METHOD_LENGTHS = {
  getMetrics: 0,
  enqueueUpsert: 3,
  enqueueDelete: 3,
  flush: 0,
  idle: 0,
  notifyIdle: 0,
  pump: 0,
  drain: 0,
  process: 1,
  ensureSchema: 0,
  push: 1,
} as const;
const MIRROR_ASYNC_METHODS = new Set(["flush", "drain", "process", "push"]);
const MIRROR_PROMISE_METHODS = new Set(["ensureSchema"]);

const OUTBOX_PUBLIC_METHODS = [
  "install",
  "getStats",
  "startLoop",
  "stopLoop",
  "flush",
  "drainOnce",
] as const satisfies readonly (keyof RemoteTodosShadowOutbox)[];
const OUTBOX_RUNTIME_METHOD_LENGTHS = {
  install: 0,
  getStats: 0,
  countByStatus: 1,
  startLoop: 0,
  stopLoop: 0,
  flush: 0,
  drainOnce: 0,
  processRow: 1,
  buildSnapshot: 1,
  readCurrent: 2,
  tombstone: 2,
  ensureSchema: 0,
} as const;
const OUTBOX_ASYNC_METHODS = new Set(["flush", "drainOnce", "processRow", "buildSnapshot", "readCurrent"]);
const OUTBOX_PROMISE_METHODS = new Set(["ensureSchema"]);

const MIRROR_PUBLIC_METHODS_COMPLETE: Exclude<
  keyof RemoteTodosShadowMirror,
  typeof MIRROR_PUBLIC_METHODS[number]
> extends never ? true : never = true;
const OUTBOX_PUBLIC_METHODS_COMPLETE: Exclude<
  keyof RemoteTodosShadowOutbox,
  typeof OUTBOX_PUBLIC_METHODS[number]
> extends never ? true : never = true;
void MIRROR_PUBLIC_METHODS_COMPLETE;
void OUTBOX_PUBLIC_METHODS_COMPLETE;

function unavailablePublicStorageCapability(): never {
  throw new TodosHostedStorageUnavailableError("explicit_hosted");
}

function unavailablePublicStorageFunction<T extends (...args: any[]) => unknown>(
  name: string,
  length: number,
): T {
  const unavailable = function (..._args: unknown[]): never {
    return unavailablePublicStorageCapability();
  };
  Object.defineProperties(unavailable, {
    name: { value: name, configurable: true },
    length: { value: length, configurable: true },
  });
  return unavailable as unknown as T;
}

function unavailablePublicStorageAsyncFunction<T extends (...args: any[]) => unknown>(
  name: string,
  length: number,
): T {
  const unavailable = async function (..._args: unknown[]): Promise<never> {
    return unavailablePublicStorageCapability();
  };
  Object.defineProperties(unavailable, {
    name: { value: name, configurable: true },
    length: { value: length, configurable: true },
  });
  return unavailable as unknown as T;
}

function unavailablePublicStoragePromiseFunction<T extends (...args: any[]) => unknown>(
  name: string,
  length: number,
): T {
  const unavailable = function (..._args: unknown[]): Promise<never> {
    return Promise.reject(unavailablePublicStorageError());
  };
  Object.defineProperties(unavailable, {
    name: { value: name, configurable: true },
    length: { value: length, configurable: true },
  });
  return unavailable as unknown as T;
}

function unavailablePublicStorageError(): TodosHostedStorageUnavailableError {
  return new TodosHostedStorageUnavailableError("explicit_hosted");
}

function installUnavailableMethods(
  target: object,
  methods: Readonly<Record<string, number>>,
  asyncMethods: ReadonlySet<string>,
  promiseMethods: ReadonlySet<string>,
): void {
  for (const [name, length] of Object.entries(methods)) {
    const method = asyncMethods.has(name)
      ? unavailablePublicStorageAsyncFunction(name, length)
      : promiseMethods.has(name)
        ? unavailablePublicStoragePromiseFunction(name, length)
        : unavailablePublicStorageFunction(name, length);
    Object.defineProperty(target, name, {
      value: method,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}

/** Stage-A class stub preserving the former mirror value/type/prototype contract. */
export class TodosShadowMirror {
  constructor(_options: CreateShadowTodosStorageAdapterOptions) {
    unavailablePublicStorageCapability();
  }
}

export interface TodosShadowMirror extends TodosShadowMirrorPublic {}

/** Stage-A class stub preserving the former outbox value/type/prototype contract. */
export class TodosShadowOutbox {
  constructor(_options: CreateTodosShadowOutboxOptions) {
    unavailablePublicStorageCapability();
  }
}

export interface TodosShadowOutbox extends TodosShadowOutboxPublic {}

/** Alternate direct-import compatibility without loading or constructing Postgres. */
export class PostgresTodosSyncStore {
  constructor(_options: ConstructorParameters<typeof RemotePostgresTodosSyncStore>[0]) {
    unavailablePublicStorageCapability();
  }

  async ensureSchema(): Promise<never> { return unavailablePublicStorageCapability(); }
  async pushSnapshot(_snapshot: unknown): Promise<never> { return unavailablePublicStorageCapability(); }
  async pullSnapshot(..._args: unknown[]): Promise<never> { return unavailablePublicStorageCapability(); }
  async getCursor(_source: unknown): Promise<never> { return unavailablePublicStorageCapability(); }
  async setCursor(_source: unknown, _cursor: unknown): Promise<never> { return unavailablePublicStorageCapability(); }
}

export const DEFAULT_TODOS_POSTGRES_CURSOR_TABLE = "todos_sync_cursors";
export const DEFAULT_TODOS_POSTGRES_SYNC_TABLE = "todos_sync_records";
export const SHADOW_TRIGGER_TABLES = [
  { table: "tasks", objectType: "tasks", deletes: true },
  { table: "projects", objectType: "projects", deletes: true },
  { table: "project_machine_paths", objectType: "project_machine_paths", deletes: true },
  { table: "plans", objectType: "plans", deletes: true },
  { table: "agents", objectType: "agents", deletes: false },
  { table: "task_lists", objectType: "task_lists", deletes: true },
  { table: "task_templates", objectType: "templates", deletes: true },
  { table: "task_history", objectType: "audit_history", deletes: false },
] as const;

export const assertRuntimeShadowRemoteAccessDisabled = unavailablePublicStorageFunction<
  typeof import("./shadow-runtime.js").assertRuntimeShadowRemoteAccessDisabled
>("assertRuntimeShadowRemoteAccessDisabled", 0);

installUnavailableMethods(
  TodosShadowMirror.prototype,
  MIRROR_RUNTIME_METHOD_LENGTHS,
  MIRROR_ASYNC_METHODS,
  MIRROR_PROMISE_METHODS,
);
installUnavailableMethods(
  TodosShadowOutbox.prototype,
  OUTBOX_RUNTIME_METHOD_LENGTHS,
  OUTBOX_ASYNC_METHODS,
  OUTBOX_PROMISE_METHODS,
);

export const createHybridTodosStorageAdapter = unavailablePublicStorageFunction<typeof import("./hybrid.js").createHybridTodosStorageAdapter>("createHybridTodosStorageAdapter", 1);
export const createShadowTodosStorageAdapter = unavailablePublicStorageFunction<typeof import("./shadow.js").createShadowTodosStorageAdapter>("createShadowTodosStorageAdapter", 1);
export const createTodosShadowOutbox = unavailablePublicStorageFunction<typeof import("./shadow-outbox.js").createTodosShadowOutbox>("createTodosShadowOutbox", 1);
export const installShadowOutboxSchema = unavailablePublicStorageFunction<typeof import("./shadow-outbox.js").installShadowOutboxSchema>("installShadowOutboxSchema", 1);
export const maybeInstallShadowCapture = unavailablePublicStorageFunction<typeof import("./shadow-runtime.js").maybeInstallShadowCapture>("maybeInstallShadowCapture", 1);
export const getRuntimeShadowOutbox = unavailablePublicStorageFunction<typeof import("./shadow-runtime.js").getRuntimeShadowOutbox>("getRuntimeShadowOutbox", 1);
export const startRuntimeShadowDrain = unavailablePublicStorageFunction<typeof import("./shadow-runtime.js").startRuntimeShadowDrain>("startRuntimeShadowDrain", 1);
export const registerShadowExitFlush = unavailablePublicStorageFunction<typeof import("./shadow-runtime.js").registerShadowExitFlush>("registerShadowExitFlush", 1);
export const closeRuntimeShadowCloud = unavailablePublicStorageAsyncFunction<typeof import("./shadow-runtime.js").closeRuntimeShadowCloud>("closeRuntimeShadowCloud", 0);
export const createTodosCloudQueryClient = unavailablePublicStorageFunction<typeof import("./cloud-client.js").createTodosCloudQueryClient>("createTodosCloudQueryClient", 1);
export const createTodosCloudQueryClientFromEnv = unavailablePublicStorageFunction<typeof import("./cloud-client.js").createTodosCloudQueryClientFromEnv>("createTodosCloudQueryClientFromEnv", 0);
export const planRunArtifactsS3Sync = unavailablePublicStorageFunction<typeof import("./s3-artifact-sync.js").planRunArtifactsS3Sync>("planRunArtifactsS3Sync", 1);
export const uploadRunArtifactsToS3 = unavailablePublicStorageAsyncFunction<typeof import("./s3-artifact-sync.js").uploadRunArtifactsToS3>("uploadRunArtifactsToS3", 1);
export const downloadRunArtifactsFromS3 = unavailablePublicStorageAsyncFunction<typeof import("./s3-artifact-sync.js").downloadRunArtifactsFromS3>("downloadRunArtifactsFromS3", 1);
export const createPostgresTodosStorageAdapter = unavailablePublicStorageFunction<typeof import("./postgres-adapter.js").createPostgresTodosStorageAdapter>("createPostgresTodosStorageAdapter", 1);
export const createPostgresTodosSyncStore = unavailablePublicStorageFunction<typeof import("./postgres-sync.js").createPostgresTodosSyncStore>("createPostgresTodosSyncStore", 1);
export const ensurePostgresScopedSlugUniqueIndexes = unavailablePublicStorageAsyncFunction<typeof import("./postgres-sync.js").ensurePostgresScopedSlugUniqueIndexes>("ensurePostgresScopedSlugUniqueIndexes", 1);
export const createTodosS3ArtifactStore = unavailablePublicStorageFunction<typeof import("./s3-artifacts.js").createTodosS3ArtifactStore>("createTodosS3ArtifactStore", 1);
export const backfillPostgresCommentRedaction = unavailablePublicStorageAsyncFunction<typeof import("./comment-redaction-backfill.js").backfillPostgresCommentRedaction>("backfillPostgresCommentRedaction", 1);
