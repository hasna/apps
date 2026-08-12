import { Database } from "bun:sqlite";
import { closeDb } from "./db.js";
import {
  createMessageExport,
  getMessagesForAgent,
  getPinnedMessages,
  getUnreadBlockerPreviews,
  readMentionPreviews,
  readMessagePreviews,
  searchMessagePreviews,
} from "./messages.js";
import { readChannelNotifications } from "./channel-notifications.js";
import { _resetAutoName } from "./identity.js";

type LocalReadOperation =
  | "readMessagePreviews"
  | "searchMessagePreviews"
  | "getUnreadBlockerPreviews"
  | "readMentionPreviews"
  | "getMessagesForAgent"
  | "getPinnedMessages"
  | "readChannelNotifications"
  | "createMessageExport"
  | "__cancellationProbe";

interface WorkerRequest {
  /**
   * Echoed on every reply. The parent pools these workers, so a reply has to
   * name the request it belongs to; anything else is a straggler and is dropped
   * there rather than answering the request now holding this worker.
   */
  id: number;
  operation: LocalReadOperation;
  args: unknown[];
  dbPath: string;
  exportDir?: string;
  tenantId?: string;
  authorityId?: string;
}

function configure(request: WorkerRequest): void {
  // A fresh Worker per read used to guarantee this; pooling has to do it
  // explicitly, or one request's resolved agent name outlives the environment
  // that produced it and answers for the next.
  _resetAutoName();
  process.env.CONVERSATIONS_DB_PATH = request.dbPath;
  delete process.env.HASNA_CONVERSATIONS_DB_PATH;
  if (request.exportDir) process.env.CONVERSATIONS_EXPORT_DIR = request.exportDir;
  else delete process.env.CONVERSATIONS_EXPORT_DIR;
  if (request.tenantId) process.env.HASNA_CONVERSATIONS_TENANT_ID = request.tenantId;
  else delete process.env.HASNA_CONVERSATIONS_TENANT_ID;
  if (request.authorityId) process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID = request.authorityId;
  else delete process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID;
}

function cancellationProbe(dbPath: string): never {
  // Read-only work intentionally large enough to remain active until the parent
  // terminates this worker. The marker write is proof that killed workers cannot
  // continue into a later mutation.
  const db = new Database(dbPath);
  try {
    db.query(`
      WITH RECURSIVE counter(value) AS (
        VALUES(0)
        UNION ALL
        SELECT value + 1 FROM counter WHERE value < 1000000000
      )
      SELECT sum(value) FROM counter
    `).get();
    db.exec("CREATE TABLE IF NOT EXISTS local_read_cancellation_probe (value INTEGER NOT NULL)");
    db.exec("INSERT INTO local_read_cancellation_probe (value) VALUES (1)");
    throw new Error("cancellation probe unexpectedly completed");
  } finally {
    db.close();
  }
}

/**
 * One request at a time, start to finish, with no await inside: that is what
 * lets a pooled worker be reused safely. `configure` rewrites process-wide env
 * for the request it is about to serve, and because this handler never yields,
 * no other request can observe another's environment or database handle.
 */
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  configure(request);
  self.postMessage({ id: request.id, type: "started" });
  let envelope:
    | { id: number; type: "result"; result: unknown }
    | { id: number; type: "error"; error: string; name: string };
  try {
    let result: unknown;
    switch (request.operation) {
      case "readMessagePreviews":
        result = readMessagePreviews(request.args[0] as never);
        break;
      case "searchMessagePreviews":
        result = searchMessagePreviews(request.args[0] as never);
        break;
      case "getUnreadBlockerPreviews":
        result = getUnreadBlockerPreviews(request.args[0] as string, request.args[1] as never);
        break;
      case "readMentionPreviews":
        result = readMentionPreviews(request.args[0] as string, request.args[1] as never);
        break;
      case "getMessagesForAgent":
        result = getMessagesForAgent(request.args[0] as string, request.args[1] as never);
        break;
      case "getPinnedMessages":
        result = getPinnedMessages(request.args[0] as never);
        break;
      case "readChannelNotifications":
        result = readChannelNotifications(request.args[0] as never);
        break;
      case "createMessageExport":
        result = createMessageExport(request.args[0] as never);
        break;
      case "__cancellationProbe":
        result = cancellationProbe(request.dbPath);
        break;
      default:
        throw new Error("unknown local collection operation");
    }
    envelope = { id: request.id, type: "result", result };
  } catch (error) {
    envelope = {
      id: request.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error",
    };
  }
  // Close the database but NOT the worker: the connection is per-request state
  // (each request names its own dbPath), while the worker itself is the thing
  // being reused. The parent terminates it when the pool is done with it.
  closeDb();
  self.postMessage(envelope);
};
