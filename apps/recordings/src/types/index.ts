// ── Recording Types ──────────────────────────────────────────────────────────

export interface Recording {
  id: string;
  audio_path: string | null;
  /** Object key of the uploaded audio in the configured artifact bucket, when the upload happened. */
  audio_object_key: string | null;
  /** Lowercase hex sha-256 of the uploaded audio bytes; content-addressed storage identity. */
  audio_sha256: string | null;
  /** Byte size of the uploaded audio object. */
  audio_bytes: number | null;
  raw_text: string;
  processed_text: string | null;
  processing_mode: ProcessingMode;
  model_used: string;
  enhancement_model: string | null;
  duration_ms: number;
  language: string | null;
  tags: string[];
  agent_id: string | null;
  project_id: string | null;
  session_id: string | null;
  goal: string | null;
  role: string | null;
  task_list_id: string | null;
  machine_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ProcessingMode = "raw" | "enhanced";

export interface CreateRecordingInput {
  /** Stable caller-owned identity for retrying one logical recording create. */
  id?: string;
  audio_path?: string;
  audio_object_key?: string;
  audio_sha256?: string;
  audio_bytes?: number;
  raw_text: string;
  processed_text?: string;
  processing_mode?: ProcessingMode;
  model_used?: string;
  enhancement_model?: string;
  duration_ms?: number;
  language?: string;
  tags?: string[];
  agent_id?: string;
  project_id?: string;
  session_id?: string;
  goal?: string;
  role?: string;
  task_list_id?: string;
  machine_id?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordingFilter {
  agent_id?: string;
  project_id?: string;
  session_id?: string;
  processing_mode?: ProcessingMode;
  tags?: string[];
  search?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

// ── Agent Types ─────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  role: string;
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string;
}

// ── Project Types ───────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  path: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ── Config Types ────────────────────────────────────────────────────────────

export type PostProcessingMode = "off" | "auto" | "always";

export interface RecordingsConfig {
  openai_api_key: string;
  enhancement_api_key: string;
  transcription_model: string;
  realtime_session_model?: string;
  realtime_transcription_model?: string;
  enhancement_model: string;
  transcriber_model?: string;
  language: string;
  audio_format: "wav" | "mp3" | "m4a" | "webm";
  sample_rate: number;
  record_command: string;
  hotkey: string;
  transcription_prompt?: string;
  transcriber_prompt?: string;
  post_processing_mode?: PostProcessingMode;
  auto_enhance: boolean;
  enhance_triggers: string[];
  keyword_transforms: Record<string, string>; // Map of phrases to their replacements
  db_path: string;
  audio_dir: string;
  max_recording_seconds: number; // Maximum recording duration in seconds (default: 1800 = 30 minutes)
  /** Artifact bucket for uploaded audio (HASNA_RECORDINGS_S3_BUCKET / RECORDINGS_S3_BUCKET). Empty = local-only. */
  s3_bucket: string;
  /** Object-key prefix inside the bucket; defaults to "recordings" when the bucket is set. */
  s3_prefix: string;
  /** AWS region for the S3 client; defaults to AWS_REGION, then us-east-1. */
  s3_region: string;
  config_warnings?: string[];
}

// ── Transcription Types ─────────────────────────────────────────────────────

export interface TranscriptionResult {
  text: string;
  duration_ms: number;
  model: string;
  language: string | null;
}

export interface EnhancementResult {
  original: string;
  enhanced: string;
  model: string;
  reasoning: string | null;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class RecordingNotFoundError extends Error {
  constructor(id: string) {
    super(`Recording not found: ${id}`);
    this.name = "RecordingNotFoundError";
  }
}

export class RecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingError";
  }
}

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export class EnhancementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnhancementError";
  }
}
