import { z } from "zod";
import { ContractValidationError, optionalWireMetadata, recordingIDParser, type ContractParser, type JSONValue } from "./stream-v1.js";
export type { ContractParser, ContractResult, JSONValue } from "./stream-v1.js";
export { ContractValidationError } from "./stream-v1.js";

export interface HostedRecordingInput { id: string; sessionId?: string; title: string; transcript: string; durationMs: number }
export interface HostedRecording extends HostedRecordingInput { createdAt: string; updatedAt: string; provenance?: Record<string, JSONValue>; [key: string]: unknown }
export interface HostedPasteInput {
  id: string; recordingId?: string | null; text: string; destinationAppId?: string; destinationAppName?: string;
  status: "attempted" | "confirmed" | "failed"; occurredAt?: string;
}
export interface HostedPasteReceipt extends HostedPasteInput {
  recordingId: string | null; occurredAt: string; createdAt: string; updatedAt: string;
  /** Reported by the client; the server does not independently observe the paste target. */
  evidenceSource: "client_reported"; [key: string]: unknown;
}
export interface HostedAccount { id: string; displayName: string; email: string; createdAt: string; [key: string]: unknown }
export interface HostedPageOptions { limit?: number; before?: string; beforeId?: string }
export interface HostedAccountResponse { account: HostedAccount; wireVersion?: string; capabilities?: string[]; [key: string]: unknown }
export interface HostedVersionResponse { name: "recordings"; version: string; apiVersion: "v1"; wireVersion?: string; capabilities?: string[]; [key: string]: unknown }
export interface HostedHealthResponse { status: "ok"; [key: string]: unknown }
export interface HostedReadyResponse { status: "ready"; [key: string]: unknown }

function parser<T>(schema: { parse(value: unknown): T }): ContractParser<T> {
  return {
    parse(value) { try { return schema.parse(value); } catch { throw new ContractValidationError(); } },
    safeParse(value) { try { return { success: true, data: schema.parse(value) }; } catch { return { success: false, error: { code: "invalid_contract" } }; } },
  };
}
const json: z.ZodType<JSONValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json)]));
const object = <S extends z.ZodRawShape>(shape: S) => z.object(shape).catchall(json);
const id = z.string().refine(value => recordingIDParser.safeParse(value).success);
// Zod3 permits absent seconds and compact offsets; the v1 wire uses RFC3339
// qualified times with seconds and colon-separated offsets, matching Zod4.
const timestamp = z.string().datetime({ offset: true }).regex(/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$(?![\s\S])/);
const utcTimestamp = z.string().datetime().regex(/T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$(?![\s\S])/);
const title = z.string().trim().min(1).max(200);
const recordingInput = z.object({ id, sessionId: id.optional(), title, transcript: z.string().max(256_000), durationMs: z.number().finite().min(0).max(1_800_000) }).strict();
const recording = object({ ...recordingInput.shape, createdAt: timestamp, updatedAt: timestamp, provenance: z.record(json).optional() });
// Request timestamps match the deployed UTC-only input. Responses may include an offset.
const pasteInput = z.object({ id, recordingId: id.nullable().optional(), text: z.string().max(256_000),
  destinationAppId: z.string().min(1).max(255).optional(), destinationAppName: z.string().min(1).max(200).optional(),
  status: z.enum(["attempted", "confirmed", "failed"]), occurredAt: utcTimestamp.optional() }).strict();
const receipt = object({ ...pasteInput.shape, recordingId: id.nullable(), occurredAt: timestamp,
  createdAt: timestamp, updatedAt: timestamp, evidenceSource: z.literal("client_reported") });
const account = object({ id, displayName: z.string(), email: z.string(), createdAt: timestamp });
const advertised = { wireVersion: z.string().optional(), capabilities: z.array(z.string()).max(32).optional() };
const compatible = (value: { wireVersion?: unknown; capabilities?: unknown }) => {
  try { optionalWireMetadata(value); return true; } catch { return false; }
};
export const recordingInputParser: ContractParser<HostedRecordingInput> = parser(recordingInput);
export const recordingParser: ContractParser<HostedRecording> = parser(recording);
export const pasteInputParser: ContractParser<HostedPasteInput> = parser(pasteInput);
export const pasteReceiptParser: ContractParser<HostedPasteReceipt> = parser(receipt);
export const pageOptionsParser: ContractParser<HostedPageOptions> = parser(z.object({ limit: z.number().int().min(1).max(100).optional(),
  before: timestamp.optional(), beforeId: id.optional() }).strict().refine(value => (value.beforeId === undefined) === (value.before === undefined)));
export const bootstrapInputParser: ContractParser<Record<string, never>> = parser(z.object({}).strict());
export const renameInputParser: ContractParser<{ title: string }> = parser(z.object({ title }).strict());
export const accountResponseParser: ContractParser<HostedAccountResponse> = parser(object({ account, ...advertised }).refine(compatible));
export const versionResponseParser: ContractParser<HostedVersionResponse> = parser(object({ name: z.literal("recordings"), version: z.string(), apiVersion: z.literal("v1"), ...advertised }).refine(compatible));
export const healthResponseParser: ContractParser<HostedHealthResponse> = parser(object({ status: z.literal("ok") }));
export const readyResponseParser: ContractParser<HostedReadyResponse> = parser(object({ status: z.literal("ready") }));
export const recordingResponseParser: ContractParser<{ recording: HostedRecording; [key: string]: unknown }> = parser(object({ recording }));
export const recordingListParser: ContractParser<{ recordings: HostedRecording[]; [key: string]: unknown }> = parser(object({ recordings: z.array(recording).max(100) }));
export const pasteResponseParser: ContractParser<{ receipt: HostedPasteReceipt; [key: string]: unknown }> = parser(object({ receipt }));
export const pasteListParser: ContractParser<{ receipts: HostedPasteReceipt[]; [key: string]: unknown }> = parser(object({ receipts: z.array(receipt).max(100) }));
export const pendingDeletionParser: ContractParser<{ audioCleanup: { state: "pending"; [key: string]: unknown }; [key: string]: unknown }> = parser(object({ audioCleanup: object({ state: z.literal("pending") }) }));
