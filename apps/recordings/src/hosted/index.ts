import * as contract from "../contracts/hosted-v1.js";
import { recordingIDParser } from "../contracts/stream-v1.js";
import { input, output, Transport, type ClientOptions, type RequestOptions } from "./transport.js";
export { RecordingsSDKError, type SDKErrorCode, type CredentialProvider, type ClientOptions, type RequestOptions } from "./transport.js";
export { HostedLibrary, type HostedLibraryOptions, type HostedLibraryRecording, type HostedLibraryPage } from "./library.js";
export { HostedPasteHistory, type HostedPasteHistoryOptions, type HostedPasteHistoryReceipt, type HostedPasteHistoryPage } from "./paste-history.js";
export type { HostedRecordingInput as RecordingInput, HostedRecording as Recording, HostedPasteInput as PasteInput,
  HostedPasteReceipt as PasteReceipt, HostedAccount as Account, HostedAccountResponse as AccountResponse,
  HostedPageOptions as PageOptions } from "../contracts/hosted-v1.js";
export interface Cursor { before: string; beforeId: string }
export type DeletionResult = { state: "removed" } | { state: "pending" };
/** Explicit cursor for the last received row. No extra request or inferred total. */
export const recordingCursor = (last: contract.HostedRecording): Cursor => ({ before: last.createdAt, beforeId: last.id });
export const pasteCursor = (last: contract.HostedPasteReceipt): Cursor => ({ before: last.occurredAt, beforeId: last.id });

/** Hosted JSON API adapter. No native control, ambient login or automatic retry. */
export class HostedRecordingsClient {
  readonly #transport: Transport;
  constructor(options: ClientOptions) { this.#transport = new Transport(options); }
  get apiBase(): string { return this.#transport.base; }
  async health(options?: RequestOptions) { return output(contract.healthResponseParser, (await this.#transport.request("GET", "/health", false, [200], undefined, options)).data); }
  async version(options?: RequestOptions) { return output(contract.versionResponseParser, (await this.#transport.request("GET", "/version", false, [200], undefined, options)).data); }
  async ready(options?: RequestOptions) { return output(contract.readyResponseParser, (await this.#transport.request("GET", "/ready", true, [200], undefined, options)).data); }
  async account(options?: RequestOptions) { return output(contract.accountResponseParser, (await this.#transport.request("GET", "/account", true, [200], undefined, options)).data); }
  /** Caller owns broker OAuth/PKCE. Profile authority comes from the opaque bearer session. */
  async bootstrap(options?: RequestOptions) {
    return output(contract.accountResponseParser, (await this.#transport.request("POST", "/account/bootstrap", true, [200], {}, options)).data);
  }
  async logout(options?: RequestOptions): Promise<void> { await this.#transport.request("POST", "/auth/logout", true, [204], undefined, options); }
  async listRecordings(page: contract.HostedPageOptions = {}, options?: RequestOptions) {
    return output(contract.recordingListParser, (await this.#transport.request("GET", "/recordings", true, [200], undefined, options, { ...input(contract.pageOptionsParser, page) })).data);
  }
  async getRecording(id: string, options?: RequestOptions) {
    return output(contract.recordingResponseParser, (await this.#transport.request("GET", "/recordings/" + input(recordingIDParser, id), true, [200], undefined, options)).data);
  }
  async saveRecording(value: contract.HostedRecordingInput, options?: RequestOptions) {
    return output(contract.recordingResponseParser, (await this.#transport.request("POST", "/recordings", true, [201], input(contract.recordingInputParser, value), options)).data);
  }
  async renameRecording(id: string, title: string, options?: RequestOptions) {
    return output(contract.recordingResponseParser, (await this.#transport.request("PATCH", "/recordings/" + input(recordingIDParser, id), true, [200], input(contract.renameInputParser, { title }), options)).data);
  }
  /** Pending is durable deletion accepted, not completed audio purge. Repeat explicitly. */
  async deleteRecording(id: string, options?: RequestOptions): Promise<DeletionResult> {
    const response = await this.#transport.request("DELETE", "/recordings/" + input(recordingIDParser, id), true, [202, 204], undefined, options);
    if (response.status === 204) return { state: "removed" };
    output(contract.pendingDeletionParser, response.data); return { state: "pending" };
  }
  async listPasteReceipts(page: contract.HostedPageOptions = {}, options?: RequestOptions) {
    return output(contract.pasteListParser, (await this.#transport.request("GET", "/paste-history", true, [200], undefined, options, { ...input(contract.pageOptionsParser, page) })).data);
  }
  async savePasteReceipt(value: contract.HostedPasteInput, options?: RequestOptions) {
    return output(contract.pasteResponseParser, (await this.#transport.request("POST", "/paste-history", true, [201], input(contract.pasteInputParser, value), options)).data);
  }
  async deletePasteReceipt(id: string, options?: RequestOptions): Promise<void> { await this.#transport.request("DELETE", "/paste-history/" + input(recordingIDParser, id), true, [204], undefined, options); }
  async clearPasteHistory(options?: RequestOptions): Promise<void> { await this.#transport.request("DELETE", "/paste-history", true, [204], undefined, options); }
}
