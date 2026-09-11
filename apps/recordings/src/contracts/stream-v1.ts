import { z } from "zod";

/** Public wire values only. Implementations own transport, credentials and session state. */
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export type ContractResult<T> = { success: true; data: T } | { success: false; error: { code: "invalid_contract" } };
export interface ContractParser<T> {
  parse(value: unknown): T;
  safeParse(value: unknown): ContractResult<T>;
}
/** Never retains the rejected input, schema issues, a cause or a server message. */
export class ContractValidationError extends Error {
  readonly code = "invalid_contract";
  constructor() { super("The value does not match the Recordings wire contract."); this.name = "ContractValidationError"; }
}
function parser<T>(schema: { parse(value: unknown): T }): ContractParser<T> {
  return {
    parse(value) { try { return schema.parse(value); } catch { throw new ContractValidationError(); } },
    safeParse(value) { try { return { success: true, data: schema.parse(value) }; } catch { return { success: false, error: { code: "invalid_contract" } }; } },
  };
}

export const WIRE_VERSION = "1.0" as const;
export const REQUIRED_CAPABILITIES = Object.freeze(["version-negotiation", "pcm-s16le-24000-mono", "audio-ack", "session-authorize"] as const);
export const PCM_FORMAT = Object.freeze({ encoding: "pcm_s16le", sampleRateHz: 24_000, channels: 1 } as const);
export const MAX_PCM_FRAME_BYTES = 24_000;
export const MAX_PCM_BYTES = 86_400_000;
export const MAX_CONTROL_BYTES = 20_000;
export interface WireMetadata { wireVersion: string; capabilities: string[] }
export interface StreamStart {
  type: "session.start"; sessionId: string; model?: string; language?: string;
  wireVersion?: string; capabilities?: string[];
}
export type StreamControl = StreamStart | { type: "input.finish" } | { type: "session.cancel" }
  | { type: "session.authorize"; accessToken: string };
export interface StreamSegment { id: string; text: string; startSecond?: number; endSecond?: number; [key: string]: unknown }
export interface StreamTranscript {
  sessionId: string; text: string; segments?: StreamSegment[]; provenance?: Record<string, JSONValue>; [key: string]: unknown;
}
interface EventBase { sessionId: string; sequence?: number; [key: string]: unknown }
export interface AudioAccepted extends EventBase { type: "audio.accepted"; bytes: number; totalBytes: number }
export type StreamEvent =
  | (EventBase & { type: "session.ready"; format: typeof PCM_FORMAT; maxInFlightAudioBytes?: number;
      maxAudioDurationMs?: number; expiresAt?: number; wireVersion?: string; capabilities?: string[] })
  | AudioAccepted
  | (EventBase & { type: "session.authorized"; expiresAt: number })
  | (EventBase & { type: "partial" | "committed"; segment: StreamSegment })
  | (EventBase & { type: "final"; transcript: StreamTranscript; recordingId?: string })
  | (EventBase & { type: "error"; code: string; message?: string; requestId?: string });

const json: z.ZodType<JSONValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(json)]));
const object = <S extends z.ZodRawShape>(shape: S) => z.object(shape).catchall(json);
// Same RFC UUID forms as the hosted input validator, including nil and max UUIDs.
const id = z.string().regex(/^(?:[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$(?![\s\S])/);
export const recordingIDParser: ContractParser<string> = parser(id);
const metadata = z.object({
  wireVersion: z.string().regex(/^1\.(?:0|[1-9][0-9]{0,3})$(?![\s\S])/),
  capabilities: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$(?![\s\S])/)).max(32)
    .refine(values => new Set(values).size === values.length && REQUIRED_CAPABILITIES.every(value => values.includes(value))),
});
export const wireMetadataParser: ContractParser<WireMetadata> = parser(metadata);
/** Absence is legacy v1. An explicit advertisement must be complete and compatible. */
export function optionalWireMetadata(value: { wireVersion?: unknown; capabilities?: unknown }): WireMetadata | undefined {
  if (value.wireVersion === undefined && value.capabilities === undefined) return undefined;
  return wireMetadataParser.parse(value);
}
const advertised = { wireVersion: z.string().optional(), capabilities: z.array(z.string()).max(32).optional() };
function validAdvertisement(value: { wireVersion?: unknown; capabilities?: unknown }): boolean {
  try { optionalWireMetadata(value); return true; } catch { return false; }
}
const control = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.start"), sessionId: id, model: z.string().min(1).max(100).optional(),
    language: z.string().regex(/^[a-z]{2}$(?![\s\S])/).optional(), ...advertised }).strict(),
  z.object({ type: z.literal("input.finish") }).strict(),
  z.object({ type: z.literal("session.cancel") }).strict(),
  z.object({ type: z.literal("session.authorize"), accessToken: z.string().min(1).max(16_000) }).strict(),
]).refine(value => value.type !== "session.start" || validAdvertisement(value));
/** A decoded JSON control object; use parseStreamControlJSON for the byte-limited wire message. */
export const streamControlParser: ContractParser<StreamControl> = parser(control);
export function parseStreamControlJSON(message: string): StreamControl {
  try {
    if (typeof message !== "string" || message.length > MAX_CONTROL_BYTES || new TextEncoder().encode(message).byteLength > MAX_CONTROL_BYTES) throw new ContractValidationError();
    return streamControlParser.parse(JSON.parse(message));
  } catch { throw new ContractValidationError(); }
}
const count = z.number().int().nonnegative().safe();
const seconds = z.number().finite().min(0);
const segment = object({ id: z.string().min(1).max(256), text: z.string().max(256_000), startSecond: seconds.optional(), endSecond: seconds.optional() })
  .refine(value => value.endSecond === undefined || value.endSecond >= (value.startSecond ?? 0));
const transcript = object({ sessionId: id, text: z.string().max(256_000).refine(value => value.trim().length > 0),
  segments: z.array(segment).max(4_096).optional(), provenance: z.record(json).optional() })
  .refine(value => value.segments === undefined || value.segments.reduce((sum, segment) => sum + segment.text.length, 0) <= 256_000);
const base = { sessionId: id, sequence: count.optional() };
const ready = object({ ...base, type: z.literal("session.ready"), ...advertised,
  format: object({ encoding: z.literal("pcm_s16le"), sampleRateHz: z.literal(24_000), channels: z.literal(1) }),
  maxInFlightAudioBytes: z.number().int().min(24_000).max(192_000).optional(),
  maxAudioDurationMs: z.number().finite().positive().max(1_800_000).optional(), expiresAt: z.number().finite().positive().optional() });
const evenBytes = count.min(2).max(MAX_PCM_FRAME_BYTES).refine(value => value % 2 === 0);
const accepted = object({ ...base, type: z.literal("audio.accepted"), bytes: evenBytes,
  totalBytes: count.min(2).max(MAX_PCM_BYTES).refine(value => value % 2 === 0) });
const event = z.discriminatedUnion("type", [
  ready, accepted, object({ ...base, type: z.literal("session.authorized"), expiresAt: z.number().finite().positive() }),
  object({ ...base, type: z.literal("partial"), segment }), object({ ...base, type: z.literal("committed"), segment }),
  object({ ...base, type: z.literal("final"), transcript, recordingId: id.optional() }),
  object({ ...base, type: z.literal("error"), code: z.string().regex(/^[A-Za-z_]{1,64}$(?![\s\S])/),
    message: z.string().max(256_000).optional(), requestId: z.string().max(512).optional() }),
]).refine(value => value.type !== "session.ready" || validAdvertisement(value))
  .refine(value => value.type !== "audio.accepted" || value.bytes <= value.totalBytes)
  .refine(value => value.type !== "final" || (value.transcript.sessionId === value.sessionId && (value.recordingId === undefined || value.recordingId === value.sessionId)));
export const streamEventParser: ContractParser<StreamEvent> = parser(event);
/** No conversion, copy or cumulative accounting. The caller owns the session's total/buffer limits. */
export const pcmFrameParser: ContractParser<Uint8Array> = parser(z.instanceof(Uint8Array).refine(value => evenBytes.safeParse(value.byteLength).success));
/** Pure readback check; does not mutate counters or acknowledge unsent audio. */
export function acceptsAudioAcknowledgement(event: AudioAccepted, sentBytes: number, acknowledgedBytes: number): boolean {
  return accepted.safeParse(event).success && count.max(MAX_PCM_BYTES).safeParse(sentBytes).success
    && count.max(MAX_PCM_BYTES).safeParse(acknowledgedBytes).success
    && event.totalBytes >= acknowledgedBytes && event.totalBytes <= sentBytes && event.totalBytes - acknowledgedBytes === event.bytes;
}
