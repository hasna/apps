import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDbPath } from "./db.js";
import { getMessageExportDir } from "./message-exports.js";
import { resolveCollectionTimeoutMs } from "./message-previews.js";

export type LocalReadOperation =
  | "readMessagePreviews"
  | "searchMessagePreviews"
  | "getUnreadBlockerPreviews"
  | "readMentionPreviews"
  | "getMessagesForAgent"
  | "getPinnedMessages"
  | "readChannelNotifications"
  | "createMessageExport";

export class LocalCollectionTimeoutError extends Error {
  readonly code = "LOCAL_COLLECTION_TIMEOUT";
  constructor(readonly timeoutMs: number, readonly queryStarted: boolean) {
    super(`local collection exceeded timeout_ms (${timeoutMs})`);
    this.name = "LocalCollectionTimeoutError";
  }
}

/**
 * Local reads run in a Worker so a runaway query can be killed outright, but
 * they used to start a NEW Worker per read. A Worker start reloads this
 * package's whole module graph — bun:sqlite, the db open with its schema and
 * migration pass, every message helper — so that cost was paid per read rather
 * than once per process. Measured on an idle box, ten sequential empty reads
 * cost 1065-1236ms that way against 131-362ms pooled. Small per read, but the
 * suite pays it thousands of times, and every CLI end-to-end test pays it again
 * in each subprocess it spawns; that accumulation is what pushed the full gate
 * past 900s (todos 0ae63bc7).
 *
 * Workers are pooled and addressed by request id instead. Hard cancellation is
 * unchanged: a timed-out worker is terminated and never handed back, so a query
 * caught mid-flight cannot go on to mutate anything. Because ids are issued
 * once and never reused, a reply that outlives its own request is dropped
 * rather than satisfying whichever request holds that worker next.
 */
const MAX_IDLE_WORKERS = 4;

interface PendingRequest {
  readonly id: number;
  queryStarted: boolean;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PooledWorker {
  /** Identity for tests, so "this worker never came back" is assertable. */
  readonly id: number;
  readonly worker: Worker;
  pending: PendingRequest | null;
}

const idleWorkers: PooledWorker[] = [];
let busyWorkers = 0;
let createdWorkers = 0;
let nextRequestId = 1;
let nextWorkerId = 1;

function workerUrl(): URL {
  const configured = process.env.CONVERSATIONS_LOCAL_READ_WORKER?.trim();
  if (configured) return new URL(configured, import.meta.url);
  const candidates = [
    new URL("./local-read-worker.ts", import.meta.url),
    new URL("./local-read-worker.js", import.meta.url),
    new URL("../bin/local-read-worker.js", import.meta.url),
  ];
  const found = candidates.find((candidate) => existsSync(fileURLToPath(candidate)));
  if (!found) throw new Error("local collection worker is missing from this installation");
  return found;
}

interface WorkerEnvelope {
  id?: number;
  type: "started" | "result" | "error";
  result?: unknown;
  error?: string;
  name?: string;
}

/**
 * An idle worker must not hold the event loop open, or every process that ever
 * read once would hang at exit. While a request is in flight the pending
 * timeout timer keeps the loop alive on its own.
 */
function setWorkerRef(worker: Worker, referenced: boolean): void {
  const handle = worker as unknown as { ref?: () => void; unref?: () => void };
  if (referenced) handle.ref?.();
  else handle.unref?.();
}

/**
 * Finish the request this worker is holding. `reusable` is false whenever the
 * worker's state is no longer trustworthy — a timeout kill or a worker-level
 * error — in which case it is terminated instead of pooled.
 */
function settle(pooled: PooledWorker, reusable: boolean, outcome: () => void): void {
  const pending = pooled.pending;
  if (!pending) return;
  pooled.pending = null;
  clearTimeout(pending.timer);
  busyWorkers -= 1;
  if (reusable && idleWorkers.length < MAX_IDLE_WORKERS) {
    setWorkerRef(pooled.worker, false);
    idleWorkers.push(pooled);
  } else {
    pooled.worker.terminate();
  }
  outcome();
}

function discardIdle(pooled: PooledWorker): void {
  const index = idleWorkers.indexOf(pooled);
  if (index >= 0) idleWorkers.splice(index, 1);
  pooled.worker.terminate();
}

function createWorker(): PooledWorker {
  const pooled: PooledWorker = {
    id: nextWorkerId++,
    worker: new Worker(workerUrl(), { type: "module" }),
    pending: null,
  };
  createdWorkers += 1;

  pooled.worker.onmessage = (event: MessageEvent<WorkerEnvelope>) => {
    const envelope = event.data;
    const pending = pooled.pending;
    // A reply carrying any other id belongs to a request that is already gone.
    // Ids are never reused, so dropping it here is what stops a straggler from
    // resolving the request that happens to hold this worker now.
    if (!pending || envelope.id !== pending.id) return;
    if (envelope.type === "started") {
      pending.queryStarted = true;
      return;
    }
    if (envelope.type === "error") {
      const error = new Error(envelope.error || "local collection worker failed");
      error.name = envelope.name || "Error";
      settle(pooled, true, () => pending.reject(error));
      return;
    }
    settle(pooled, true, () => pending.resolve(envelope.result));
  };

  pooled.worker.onerror = (event) => {
    const message = event.message || "local collection worker failed";
    if (!pooled.pending) {
      discardIdle(pooled);
      return;
    }
    const pending = pooled.pending;
    settle(pooled, false, () => pending.reject(new Error(message)));
  };

  return pooled;
}

function acquireWorker(): PooledWorker {
  const pooled = idleWorkers.pop() ?? createWorker();
  setWorkerRef(pooled.worker, true);
  return pooled;
}

async function executeWorker<T>(
  operation: LocalReadOperation | "__cancellationProbe",
  args: unknown[],
  timeoutValue: unknown,
): Promise<T> {
  const timeoutMs = resolveCollectionTimeoutMs(timeoutValue);
  const pooled = acquireWorker();
  const id = nextRequestId++;

  return await new Promise<T>((resolve, reject) => {
    const pending: PendingRequest = {
      id,
      queryStarted: false,
      resolve: resolve as (value: unknown) => void,
      reject,
      timer: setTimeout(() => {
        // Hard cancellation: the worker dies with the request, so a query still
        // mid-flight can never reach a later write.
        settle(pooled, false, () =>
          reject(new LocalCollectionTimeoutError(timeoutMs, pending.queryStarted)),
        );
      }, timeoutMs),
    };
    pooled.pending = pending;
    busyWorkers += 1;
    pooled.worker.postMessage({
      id,
      operation,
      args,
      dbPath: getDbPath(),
      exportDir: operation === "createMessageExport" ? getMessageExportDir() : undefined,
      tenantId: process.env.HASNA_CONVERSATIONS_TENANT_ID,
      authorityId: process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID,
    });
  });
}

export function runLocalReadWorker<T>(operation: LocalReadOperation, args: unknown[], timeoutValue: unknown): Promise<T> {
  return executeWorker<T>(operation, args, timeoutValue);
}

/** Test-only deterministic probe for worker termination and no-late-mutation. */
export function runLocalCancellationProbeForTests(timeoutMs: number): Promise<never> {
  return executeWorker<never>("__cancellationProbe", [], timeoutMs);
}

export function activeLocalReadWorkerCountForTests(): number {
  return busyWorkers;
}

/**
 * Ids of the pooled workers, oldest first — `acquireWorker` pops the last.
 * Asserting on identity rather than on a count keeps a regression honest in
 * `bun test`, where every file shares this pool and an unrelated file's read can
 * return a worker to it at any moment.
 */
export function idleLocalReadWorkerIdsForTests(): number[] {
  return idleWorkers.map((pooled) => pooled.id);
}

/** Total Workers ever started; the pooling regression asserts against this. */
export function createdLocalReadWorkerCountForTests(): number {
  return createdWorkers;
}

/** Terminate pooled workers so a suite can prove it leaves none behind. */
export function disposeLocalReadWorkersForTests(): void {
  while (idleWorkers.length > 0) idleWorkers.pop()!.worker.terminate();
}
