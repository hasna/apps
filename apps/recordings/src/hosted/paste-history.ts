import { pasteCursor, type HostedRecordingsClient, type Cursor } from "./index.js";
import type { HostedPasteReceipt } from "../contracts/hosted-v1.js";
import type { RequestOptions } from "./transport.js";
import { textOption } from "./read-options.js";

export interface HostedPasteHistoryOptions {
  limit?: number;
  before?: string;
  beforeId?: string;
  includeText?: boolean;
}
export interface HostedPasteHistoryReceipt {
  id: string;
  recordingId: string | null;
  occurredAt: string;
  destinationAppId?: string;
  destinationAppName?: string;
  status: HostedPasteReceipt["status"];
  /** The server retains the client's report; it does not observe the target app. */
  evidenceSource: "client_reported";
  text?: string;
}
export interface HostedPasteHistoryPage {
  receipts: HostedPasteHistoryReceipt[];
  /** A full page permits another request; it does not prove more rows exist. */
  nextCursor: Cursor | null;
}
function project(row: HostedPasteReceipt, includeText: boolean): HostedPasteHistoryReceipt {
  return { id: row.id, recordingId: row.recordingId, occurredAt: row.occurredAt,
    ...(row.destinationAppId === undefined ? {} : { destinationAppId: row.destinationAppId }),
    ...(row.destinationAppName === undefined ? {} : { destinationAppName: row.destinationAppName }),
    status: row.status, evidenceSource: row.evidenceSource, ...(includeText ? { text: row.text } : {}) };
}

/** Read-only receipt projection; never reads a native/local store or upgrades delivery evidence. */
export class HostedPasteHistory {
  constructor(private readonly client: HostedRecordingsClient) {}
  async list(options: HostedPasteHistoryOptions = {}, request?: RequestOptions): Promise<HostedPasteHistoryPage> {
    const includeText = textOption(options, ["limit", "before", "beforeId", "includeText"]);
    const limit = options.limit === undefined ? 25 : options.limit;
    const { receipts } = await this.client.listPasteReceipts({
      limit, ...(options.before === undefined ? {} : { before: options.before }),
      ...(options.beforeId === undefined ? {} : { beforeId: options.beforeId }),
    }, request);
    const last = receipts.at(-1);
    return { receipts: receipts.map(row => project(row, includeText)),
      nextCursor: receipts.length === limit && last ? pasteCursor(last) : null };
  }
}
