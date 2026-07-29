// ── Types ───────────────────────────────────────────────────────────────────
export type {
  Recording,
  CreateRecordingInput,
  RecordingFilter,
  ProcessingMode,
  PostProcessingMode,
  RealtimeTranscriptionDelay,
  Agent,
  Project,
  RecordingsConfig,
  TranscriptionResult,
  EnhancementResult,
} from "./types/index.js";

export {
  RecordingNotFoundError,
  RecordingError,
  TranscriptionError,
  EnhancementError,
} from "./types/index.js";

// ── Storage abstraction (LocalStore + ApiStore behind one Store) ──────────────
export { getStore, __resetStore, APP } from "./store.js";
export type { Store, RecordingStats, FeedbackInput } from "./store.js";
export {
  resolveStorageClient,
  resolveTransport,
  createHttpTransport,
  createStorageClient,
  HasnaHttpError,
} from "./http/client.js";
export type {
  StorageClient,
  StorageMode,
  TransportResolution,
  HttpTransport,
} from "./http/client.js";

// ── Config ──────────────────────────────────────────────────────────────────
export {
  loadConfig,
  getDataDir,
  ensureDataDir,
  DEFAULT_CONFIG,
  DEFAULT_TRANSCRIPTION_MODEL,
  DEFAULT_REALTIME_SESSION_MODEL,
  DEFAULT_REALTIME_TRANSCRIPTION_MODEL,
  DEFAULT_REALTIME_DELAY,
  REALTIME_TRANSCRIPTION_DELAYS,
  MODEL_CAPABILITIES,
  canonicalModelId,
  modelCapability,
  modelSupportsSlot,
  modelSupportsFileStreaming,
  modelsForSlot,
  buildRealtimeTranscriptionOptions,
  parseDelimitedList,
  normalizeModelSlots,
  normalizePostProcessingConfig,
  normalizePostProcessingMode,
} from "./lib/config.js";
export type { ModelCapability, ModelSlot } from "./lib/config.js";

// ── Transcription ───────────────────────────────────────────────────────────
export {
  transcribeAudio,
  transcribeBuffer,
  resetClient,
} from "./lib/transcriber.js";

// ── Enhancement ─────────────────────────────────────────────────────────────
export {
  needsEnhancement,
  enhanceText,
  processText,
  resetEnhancementClient,
} from "./lib/enhancer.js";

// ── Recorder ────────────────────────────────────────────────────────────────
export {
  startRecording,
  stopRecording,
  isRecording,
  getCurrentFile,
  checkRecordingDeps,
  recordDuration,
} from "./lib/recorder.js";

// ── SDK (typed /v1 cloud client, generated from the serve OpenAPI) ────────────
export {
  RecordingsV1Client,
  RecordingsV1ApiError,
} from "./sdk/index.js";
export type {
  RecordingsV1ClientOptions,
  RecordingsV1Recording,
  RecordingsV1Agent,
  RecordingsV1Project,
  RecordingsV1CreateRecordingInput,
  RecordingsV1RegisterAgentInput,
  RecordingsV1RegisterProjectInput,
} from "./sdk/index.js";
