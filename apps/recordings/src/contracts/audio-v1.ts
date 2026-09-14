import { z } from "zod";
import { ContractValidationError, recordingIDParser, type ContractParser } from "./stream-v1.js";

export const AUDIO_FORMAT = Object.freeze({
  encoding: "pcm_s16le",
  sampleRate: 24_000,
  channels: 1,
  bitsPerSample: 16,
} as const);
export const WAV_HEADER_BYTES = 44;
export const MAX_PCM_BYTES = 86_400_000;
export const MAX_AUDIO_BYTES = WAV_HEADER_BYTES + MAX_PCM_BYTES;

export interface HostedAudioFormat {
  encoding: "pcm_s16le";
  sampleRate: 24_000;
  channels: 1;
  bitsPerSample: 16;
}
export interface HostedAudioDescriptor {
  byteLength: number;
  pcmBytes: number;
  durationMs: number;
  sha256: string;
  storedAt: string;
  expiresAt: string;
}
export interface HostedAudioAvailable extends HostedAudioDescriptor {
  state: "available";
  format: HostedAudioFormat;
}
export interface HostedAudioUnavailable {
  state: "unavailable";
  reason: "not_stored_or_expired";
}
export type HostedAudioMetadata = HostedAudioAvailable | HostedAudioUnavailable;

function parser<T>(schema: { parse(value: unknown): T }): ContractParser<T> {
  return {
    parse(value) {
      try { return schema.parse(value); } catch { throw new ContractValidationError(); }
    },
    safeParse(value) {
      try { return { success: true, data: schema.parse(value) }; }
      catch { return { success: false, error: { code: "invalid_contract" } }; }
    },
  };
}
const timestamp = z.string().datetime({ offset: true }).regex(
  /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$(?![\s\S])/,
);
const sha256 = z.string().regex(/^[a-f0-9]{64}$(?![\s\S])/);
const byteLength = z.number().int().safe().min(WAV_HEADER_BYTES + 2).max(MAX_AUDIO_BYTES);
const pcmBytes = z.number().int().safe().min(2).max(MAX_PCM_BYTES).refine(value => value % 2 === 0);
const descriptorShape = {
  byteLength,
  pcmBytes,
  durationMs: z.number().finite().min(0).max(1_800_000),
  sha256,
  storedAt: timestamp,
  expiresAt: timestamp,
};
const format = z.object({
  encoding: z.literal("pcm_s16le"),
  sampleRate: z.literal(24_000),
  channels: z.literal(1),
  bitsPerSample: z.literal(16),
}).strict();
const available = z.object({
  state: z.literal("available"),
  format,
  ...descriptorShape,
}).strict()
  .refine(value => value.pcmBytes === value.byteLength - WAV_HEADER_BYTES)
  .refine(value => value.durationMs === value.pcmBytes / 48);
const unavailable = z.object({
  state: z.literal("unavailable"),
  reason: z.literal("not_stored_or_expired"),
}).strict();

export const audioMetadataParser: ContractParser<HostedAudioMetadata> = parser<HostedAudioMetadata>(
  z.union([available, unavailable]),
);
export const audioFormatParser: ContractParser<HostedAudioFormat> = parser(format);
export const audioSHA256Parser: ContractParser<string> = parser(sha256);
export const audioRecordingIDParser: ContractParser<string> = recordingIDParser;
