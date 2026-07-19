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
  | "exportMessages";

export class LocalCollectionTimeoutError extends Error {
  readonly code = "LOCAL_COLLECTION_TIMEOUT";
  constructor(readonly timeoutMs: number, readonly queryStarted: boolean) {
    super(`local collection exceeded timeout_ms (${timeoutMs})`);
    this.name = "LocalCollectionTimeoutError";
  }
}

let activeWorkers = 0;

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
  type: "started" | "result" | "error";
  result?: unknown;
  error?: string;
  name?: string;
}

async function executeWorker<T>(operation: LocalReadOperation | "__cancellationProbe", args: unknown[], timeoutValue: unknown): Promise<T> {
  const timeoutMs = resolveCollectionTimeoutMs(timeoutValue);
  const worker = new Worker(workerUrl(), { type: "module" });
  activeWorkers += 1;
  let settled = false;
  let queryStarted = false;

  return await new Promise<T>((resolve, reject) => {
    const finish = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      activeWorkers -= 1;
      outcome();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new LocalCollectionTimeoutError(timeoutMs, queryStarted)));
    }, timeoutMs);
    worker.onmessage = (event: MessageEvent<WorkerEnvelope>) => {
      const envelope = event.data;
      if (envelope.type === "started") {
        queryStarted = true;
        return;
      }
      if (envelope.type === "error") {
        const error = new Error(envelope.error || "local collection worker failed");
        error.name = envelope.name || "Error";
        finish(() => reject(error));
        return;
      }
      finish(() => resolve(envelope.result as T));
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || "local collection worker failed")));
    };
    worker.postMessage({
      operation,
      args,
      dbPath: getDbPath(),
      exportDir: operation === "exportMessages" ? getMessageExportDir() : undefined,
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
  return activeWorkers;
}
