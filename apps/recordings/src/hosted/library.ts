import type { HostedRecordingsClient, Cursor } from "./index.js";
import type { HostedRecording, HostedRecordingInput } from "../contracts/hosted-v1.js";
import type { HostedAudioMetadata } from "../contracts/audio-v1.js";
import type { HostedAudioDownloadOptions, HostedAudioDownloadResponse, HostedAudioUploadInput } from "./transport.js";
import type { RequestOptions } from "./transport.js";
import { textOption } from "./read-options.js";

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
/** Explicit transcript export; unlike ordinary Library reads, this contains private text. */
export interface HostedTranscriptExport {
  recordingId: string;
  fileName: string;
  mediaType: "text/plain; charset=utf-8";
  text: string;
}
export interface HostedLibraryPage {
  recordings: HostedLibraryRecording[];
  /** A full page permits another request; it does not prove more rows exist. */
  nextCursor: Cursor | null;
}

function project(row: HostedRecording, includeText: boolean): HostedLibraryRecording {
  return { id: row.id, title: row.title, createdAt: row.createdAt, durationMs: row.durationMs,
    ...(includeText ? { transcript: row.transcript } : {}) };
}

/** Library operations over the existing hosted transport; never reads a native/local store. */
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
  /** Match native plain-text export without changing the hosted recording or invoking a provider. */
  async export(id: string, request?: RequestOptions): Promise<HostedTranscriptExport> {
    const { recording } = await this.client.getRecording(id, request);
    return { recordingId: recording.id, fileName: recording.id + ".txt",
      mediaType: "text/plain; charset=utf-8", text: recording.transcript };
  }
  async getAudioMetadata(id: string, request?: RequestOptions): Promise<HostedAudioMetadata> {
    return this.client.getAudioMetadata(id, request);
  }
  async uploadAudio(id: string, upload: HostedAudioUploadInput, request?: RequestOptions): Promise<HostedAudioMetadata> {
    return this.client.uploadAudio(id, upload, request);
  }
  async downloadAudio(id: string, rangeOrOptions?: string | HostedAudioDownloadOptions, request?: RequestOptions): Promise<HostedAudioDownloadResponse> {
    return this.client.downloadAudio(id, rangeOrOptions, request);
  }
  /** Renaming never opts the caller into reading the recording's private transcript. */
  async rename(id: string, title: string, request?: RequestOptions): Promise<{ recording: HostedLibraryRecording }> {
    const { recording } = await this.client.renameRecording(id, title, request);
    return { recording: project(recording, false) };
  }
  /** Save one hosted recording through the same validated transport as other Library mutations. */
  async save(value: HostedRecordingInput, request?: RequestOptions): Promise<{ recording: HostedLibraryRecording }> {
    const { recording } = await this.client.saveRecording(value, request);
    return { recording: project(recording, false) };
  }
  /** One explicit deletion request. Pending audio cleanup is not completed removal. */
  async delete(id: string, request?: RequestOptions) {
    return this.client.deleteRecording(id, request);
  }
}
