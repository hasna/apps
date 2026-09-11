import type { HostedRecordingsClient, Cursor } from "./index.js";
import type { HostedRecording } from "../contracts/hosted-v1.js";
import { RecordingsSDKError, type RequestOptions } from "./transport.js";

export interface HostedLibraryOptions {
  limit?: number;
  before?: string;
  beforeId?: string;
  includeText?: boolean;
}
export interface HostedLibraryRecording {
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
  transcript?: string;
}
export interface HostedLibraryPage {
  recordings: HostedLibraryRecording[];
  /** A full page permits another request; it does not prove more rows exist. */
  nextCursor: Cursor | null;
}

function textOption(options: object, allowed: readonly string[]): boolean {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
      Object.keys(options).some(key => !allowed.includes(key))) throw new RecordingsSDKError("invalid_input");
  const value = (options as { includeText?: unknown }).includeText;
  if (value !== undefined && typeof value !== "boolean") throw new RecordingsSDKError("invalid_input");
  return value === true;
}
function project(row: HostedRecording, includeText: boolean): HostedLibraryRecording {
  return { id: row.id, title: row.title, createdAt: row.createdAt, durationMs: row.durationMs,
    ...(includeText ? { transcript: row.transcript } : {}) };
}

/** Read-only projections over the existing hosted transport; never reads a native/local store. */
export class HostedLibrary {
  constructor(private readonly client: HostedRecordingsClient) {}
  async list(options: HostedLibraryOptions = {}, request?: RequestOptions): Promise<HostedLibraryPage> {
    const includeText = textOption(options, ["limit", "before", "beforeId", "includeText"]);
    const limit = options.limit === undefined ? 25 : options.limit;
    const { recordings } = await this.client.listRecordings({
      limit, ...(options.before === undefined ? {} : { before: options.before }),
      ...(options.beforeId === undefined ? {} : { beforeId: options.beforeId }),
    }, request);
    const last = recordings.at(-1);
    return { recordings: recordings.map(row => project(row, includeText)),
      nextCursor: recordings.length === limit && last ? { before: last.createdAt, beforeId: last.id } : null };
  }
  async get(id: string, options: { includeText?: boolean } = {}, request?: RequestOptions): Promise<{ recording: HostedLibraryRecording }> {
    const includeText = textOption(options, ["includeText"]);
    const { recording } = await this.client.getRecording(id, request);
    return { recording: project(recording, includeText) };
  }
}
