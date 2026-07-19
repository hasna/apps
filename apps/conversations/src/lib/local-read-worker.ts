import { Database } from "bun:sqlite";
import { closeDb } from "./db.js";
import {
  exportMessages,
  getMessagesForAgent,
  getPinnedMessages,
  getUnreadBlockerPreviews,
  readMentionPreviews,
  readMessagePreviews,
  searchMessagePreviews,
} from "./messages.js";
import { readChannelNotifications } from "./channel-notifications.js";

type LocalReadOperation =
  | "readMessagePreviews"
  | "searchMessagePreviews"
  | "getUnreadBlockerPreviews"
  | "readMentionPreviews"
  | "getMessagesForAgent"
  | "getPinnedMessages"
  | "readChannelNotifications"
  | "exportMessages"
  | "__cancellationProbe";

interface WorkerRequest {
  operation: LocalReadOperation;
  args: unknown[];
  dbPath: string;
  exportDir?: string;
  tenantId?: string;
  authorityId?: string;
}

function configure(request: WorkerRequest): void {
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

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  configure(request);
  self.postMessage({ type: "started" });
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
      case "exportMessages":
        result = exportMessages(request.args[0] as never);
        break;
      case "__cancellationProbe":
        result = cancellationProbe(request.dbPath);
        break;
      default:
        throw new Error("unknown local collection operation");
    }
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error",
    });
  } finally {
    closeDb();
  }
};
