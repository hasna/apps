import { z } from "zod";

import type { VideoRecordingCaptureMode, VideoRecordingCodec, VideoRecordingEncoding, VideoRecordingFormat, VideoRecordingPreset, VideoRecordingQuality } from "../types/index.js";

export const browserEngineSchema = z.enum(["playwright", "cdp", "lightpanda", "bun", "tui", "extension", "kernel", "auto"]);

export const createSessionRequestSchema = z.object({
  engine: browserEngineSchema.optional(),
  project_id: z.string().min(1).optional(),
  agent_id: z.string().min(1).optional(),
  start_url: z.string().min(1).optional(),
  headless: z.boolean().optional(),
  cdp_url: z.string().min(1).optional(),
  storage_state: z.string().min(1).optional(),
  approval_token: z.string().min(1).optional(),
  extension_server_url: z.string().min(1).optional(),
  extension_token_id: z.string().min(1).optional(),
  kernel_persistence_id: z.string().min(1).optional(),
  kernel_profile_id: z.string().min(1).optional(),
  kernel_profile_name: z.string().min(1).optional(),
  kernel_save_profile_changes: z.boolean().optional(),
  kernel_timeout_seconds: z.number().int().positive().optional(),
  kernel_project_id: z.string().min(1).optional(),
  kernel_base_url: z.string().min(1).optional(),
  kernel_request_timeout_ms: z.number().int().positive().optional(),
  kernel_proxy_id: z.string().min(1).optional(),
  kernel_gpu: z.boolean().optional(),
  kernel_kiosk_mode: z.boolean().optional(),
  kernel_tags: z.record(z.string()).optional(),
  kernel_telemetry: z.union([z.boolean(), z.record(z.unknown())]).optional(),
  kernel_chrome_policy: z.record(z.unknown()).optional(),
  kernel_env: z.record(z.string()).optional(),
  kernel_env_secrets: z.record(z.string()).optional(),
  kernel_auth_mode: z.enum(["managed", "cdp_autofill", "auto", "off"]).optional(),
}).passthrough();

export const kernelPlaywrightRequestSchema = z.object({
  code: z.string().min(1),
  timeout_sec: z.number().int().positive().max(300).optional(),
}).passthrough();

export const kernelComputerScreenshotRequestSchema = z.object({
  region: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
  filename: z.string().min(1).optional(),
}).passthrough();

export const kernelReplayStartRequestSchema = z.object({
  framerate: z.number().int().positive().max(120).optional(),
  max_duration_seconds: z.number().int().positive().optional(),
  record_audio: z.boolean().optional(),
}).passthrough();

export const extensionPairRequestSchema = z.object({
  ttl_ms: z.number().int().positive().max(15 * 60_000).optional(),
}).passthrough();

export const extensionDispatchRequestSchema = z.object({
  token_id: z.string().min(1).optional(),
  timeout_ms: z.number().int().positive().max(300_000).optional(),
  approval_token: z.string().min(1).optional(),
  job: z.object({
    id: z.string().min(1),
    type: z.enum(["ping", "navigate", "click", "type", "fill", "select", "press", "wait", "scroll", "extract", "screenshot"]),
  }).passthrough(),
}).passthrough();

export const videoStartRequestSchema = z.object({
  session_id: z.string().min(1),
  name: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  quality: z.enum(["source", "low", "medium", "high", "ultra"]).optional(),
  format: z.enum(["webm", "mp4", "mov"]).optional(),
  capture_mode: z.enum(["native", "cdp"]).optional(),
  codec: z.enum(["h264", "prores"]).optional(),
  encoding: z.enum(["balanced", "crisp", "lossless", "prores"]).optional(),
  crf: z.number().int().min(0).max(51).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  video_bitrate: z.string().min(1).optional(),
  ffmpeg_preset: z.string().min(1).optional(),
  keep_raw_video: z.boolean().optional(),
  preset: z.enum(["source", "square", "vertical", "landscape", "x-square", "x-vertical", "x-landscape", "reels", "tiktok"]).optional(),
  width: z.number().int().positive().max(7680).optional(),
  height: z.number().int().positive().max(4320).optional(),
  tui_theme: z.enum(["dark", "light", "system"]).optional(),
  tui_font_size: z.number().int().positive().max(96).optional(),
  tui_zoom: z.number().positive().max(4).optional(),
  tui_frame: z.object({
    enabled: z.boolean().optional(),
    fit: z.enum(["preset", "canvas"]).optional(),
    width: z.number().int().positive().max(7680).optional(),
    height: z.number().int().positive().max(4320).optional(),
    padding: z.number().int().min(0).max(1000).optional(),
    borderRadius: z.number().int().min(0).max(200).optional(),
    title: z.string().optional(),
    background: z.string().optional(),
    shadow: z.boolean().optional(),
  }).optional(),
}).passthrough();

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type KernelPlaywrightRequest = z.infer<typeof kernelPlaywrightRequestSchema>;
export type KernelComputerScreenshotRequest = z.infer<typeof kernelComputerScreenshotRequestSchema>;
export type KernelReplayStartRequest = z.infer<typeof kernelReplayStartRequestSchema>;
export type ExtensionPairRequest = z.infer<typeof extensionPairRequestSchema>;
export type ExtensionDispatchRequest = z.infer<typeof extensionDispatchRequestSchema>;
export type VideoStartRequest = z.infer<typeof videoStartRequestSchema> & {
  quality?: VideoRecordingQuality;
  format?: VideoRecordingFormat;
  capture_mode?: VideoRecordingCaptureMode;
  codec?: VideoRecordingCodec;
  encoding?: VideoRecordingEncoding;
  preset?: VideoRecordingPreset;
};

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}
