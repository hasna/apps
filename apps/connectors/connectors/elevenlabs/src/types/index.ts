// ElevenLabs API Types

// ============================================
// Configuration
// ============================================

export interface ElevenLabsConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// Audio output formats
export type AudioFormat =
  | 'mp3_44100_64'
  | 'mp3_44100_96'
  | 'mp3_44100_128'
  | 'mp3_44100_192'
  | 'mp3_22050_32'
  | 'pcm_16000'
  | 'pcm_22050'
  | 'pcm_24000'
  | 'pcm_44100'
  | 'ulaw_8000';

// ============================================
// Model Types
// ============================================

// TTS Model IDs
export type TTSModelId =
  | 'eleven_v3'                    // Latest v3 - most expressive
  | 'eleven_multilingual_v2'       // Multilingual v2 - stable for long-form
  | 'eleven_flash_v2_5'            // Flash v2.5 - ultra-low latency (32 langs)
  | 'eleven_flash_v2'              // Flash v2 - ultra-low latency (English)
  | 'eleven_turbo_v2_5'            // Turbo v2.5 - balanced (32 langs)
  | 'eleven_turbo_v2'              // Turbo v2 - balanced (English)
  | 'eleven_monolingual_v1'        // Deprecated
  | 'eleven_multilingual_v1';      // Deprecated

// STS Model IDs
export type STSModelId =
  | 'eleven_multilingual_sts_v2'   // Multilingual voice conversion
  | 'eleven_english_sts_v2';       // English voice conversion

// STT Model IDs
export type STTModelId =
  | 'scribe_v2'                    // Best quality transcription
  | 'scribe_v2_realtime'           // Real-time transcription
  | 'scribe_v1';                   // Legacy

// Sound/Music Model IDs
export type SoundModelId =
  | 'eleven_text_to_sound_v2'      // Sound effects
  | 'music_v1';                    // Music generation

export interface Model {
  model_id: string;
  name: string;
  description: string;
  can_be_finetuned: boolean;
  can_do_text_to_speech: boolean;
  can_do_voice_conversion: boolean;
  can_use_style: boolean;
  can_use_speaker_boost: boolean;
  serves_pro_voices: boolean;
  token_cost_factor: number;
  languages?: ModelLanguage[];
  max_characters_request_free_user?: number;
  max_characters_request_subscribed_user?: number;
  concurrency_group?: string;
}

export interface ModelLanguage {
  language_id: string;
  name: string;
}

// ============================================
// Voice Types
// ============================================

export interface Voice {
  voice_id: string;
  name: string;
  samples?: VoiceSample[];
  category?: 'premade' | 'cloned' | 'generated' | 'professional';
  fine_tuning?: VoiceFineTuning;
  labels?: Record<string, string>;
  description?: string;
  preview_url?: string;
  available_for_tiers?: string[];
  settings?: VoiceSettings;
  sharing?: VoiceSharing;
  high_quality_base_model_ids?: string[];
  safety_control?: string;
  voice_verification?: VoiceVerification;
  is_owner?: boolean;
  is_legacy?: boolean;
  is_mixed?: boolean;
  created_at_unix?: number;
}

export interface VoiceSample {
  sample_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  hash: string;
}

export interface VoiceFineTuning {
  is_allowed_to_fine_tune: boolean;
  state: Record<string, string>;
  verification_failures: string[];
  verification_attempts_count: number;
  manual_verification_requested: boolean;
  language?: string;
  progress?: Record<string, number>;
  message?: Record<string, string>;
  dataset_duration_seconds?: number;
  verification_attempts?: VerificationAttempt[];
  slice_ids?: string[];
  manual_verification?: ManualVerification;
}

export interface VerificationAttempt {
  text: string;
  date_unix: number;
  accepted: boolean;
  similarity: number;
  levenshtein_distance: number;
  recording?: VoiceRecording;
}

export interface ManualVerification {
  extra_text: string;
  request_time_unix: number;
  files: VoiceFile[];
}

export interface VoiceFile {
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  upload_date_unix: number;
}

export interface VoiceRecording {
  recording_id: string;
  mime_type: string;
  size_bytes: number;
  upload_date_unix: number;
  transcription: string;
}

export interface VoiceSettings {
  stability: number;           // 0-1, higher = more consistent
  similarity_boost: number;    // 0-1, higher = closer to original
  style?: number;              // 0-1, style exaggeration (v2+ models)
  use_speaker_boost?: boolean; // Boost similarity (v2+ models)
  speed?: number;              // 0.25-4.0, speech speed (Turbo v2.5+)
}

export interface VoiceSharing {
  status: string;
  history_item_sample_id?: string;
  date_unix?: number;
  whitelisted_emails?: string[];
  public_owner_id?: string;
  original_voice_id?: string;
  financial_rewards_enabled?: boolean;
  free_users_allowed?: boolean;
  live_moderation_enabled?: boolean;
  rate?: number;
  notice_period?: number;
  disable_at_unix?: number;
  voice_mixing_allowed?: boolean;
  featured?: boolean;
  category?: string;
  reader_app_enabled?: boolean;
  ban_reason?: string;
  liked_by_count?: number;
  cloned_by_count?: number;
  name?: string;
  description?: string;
  labels?: Record<string, string>;
  review_status?: string;
  review_message?: string;
  enabled_in_library?: boolean;
}

export interface VoiceVerification {
  requires_verification: boolean;
  is_verified: boolean;
  verification_failures: string[];
  verification_attempts_count: number;
  language?: string;
  verification_attempts?: VerificationAttempt[];
}

// ============================================
// Text-to-Speech Types
// ============================================

export interface TTSRequest {
  text: string;
  model_id?: TTSModelId;
  language_code?: string;
  voice_settings?: VoiceSettings;
  pronunciation_dictionary_locators?: PronunciationDictionaryLocator[];
  seed?: number;
  previous_text?: string;
  next_text?: string;
  previous_request_ids?: string[];
  next_request_ids?: string[];
  apply_text_normalization?: 'auto' | 'on' | 'off';
}

export interface PronunciationDictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id: string;
}

export interface TTSOptions {
  outputFormat?: AudioFormat;
  optimizeStreamingLatency?: 0 | 1 | 2 | 3 | 4;
  enableLogging?: boolean;
}

// ============================================
// Speech-to-Speech Types
// ============================================

export interface STSRequest {
  model_id?: STSModelId;
  voice_settings?: VoiceSettings;
  seed?: number;
  remove_background_noise?: boolean;
}

// ============================================
// Speech-to-Text Types
// ============================================

export interface STTRequest {
  model_id?: STTModelId;
  language_code?: string;
  tag_audio_events?: boolean;
  num_speakers?: number;
  timestamps_granularity?: 'word' | 'character' | 'segment';
  diarize?: boolean;
}

export interface STTResponse {
  text: string;
  language_code?: string;
  language_probability?: number;
  words?: STTWord[];
  utterances?: STTUtterance[];
  audio_events?: STTAudioEvent[];
}

export interface STTWord {
  text: string;
  start: number;
  end: number;
  type: 'word' | 'spacing' | 'audio_event';
  speaker_id?: string;
  characters?: STTCharacter[];
}

export interface STTCharacter {
  character: string;
  start: number;
  end: number;
}

export interface STTUtterance {
  text: string;
  start: number;
  end: number;
  speaker_id: string;
}

export interface STTAudioEvent {
  type: string;
  start: number;
  end: number;
}

// ============================================
// Sound Effects Types
// ============================================

export interface SoundEffectRequest {
  text: string;
  duration_seconds?: number;
  prompt_influence?: number; // 0-1
}

// ============================================
// History Types
// ============================================

export interface HistoryItem {
  history_item_id: string;
  request_id: string;
  voice_id: string;
  voice_name: string;
  voice_category?: string;
  model_id: string;
  text: string;
  date_unix: number;
  character_count_change_from: number;
  character_count_change_to: number;
  content_type: string;
  state: 'created' | 'deleted' | 'processing';
  settings?: VoiceSettings;
  feedback?: HistoryFeedback;
  share_link_id?: string;
  source?: string;
}

export interface HistoryFeedback {
  thumbs_up: boolean;
  feedback: string;
  emotions: boolean;
  inaccurate_clone: boolean;
  glitches: boolean;
  audio_quality: boolean;
  other: boolean;
  review_status?: string;
}

export interface HistoryResponse {
  history: HistoryItem[];
  last_history_item_id?: string;
  has_more: boolean;
}

// ============================================
// User Types
// ============================================

export interface User {
  subscription: Subscription;
  is_new_user: boolean;
  xi_api_key: string;
  can_use_delayed_payment_methods: boolean;
  is_onboarding_completed: boolean;
  is_onboarding_checklist_completed: boolean;
  first_name?: string;
}

export interface Subscription {
  tier: string;
  character_count: number;
  character_limit: number;
  can_extend_character_limit: boolean;
  allowed_to_extend_character_limit: boolean;
  next_character_count_reset_unix: number;
  voice_limit: number;
  max_voice_add_edits: number;
  voice_add_edit_counter: number;
  professional_voice_limit: number;
  can_extend_voice_limit: boolean;
  can_use_instant_voice_cloning: boolean;
  can_use_professional_voice_cloning: boolean;
  currency: string;
  status: string;
  billing_period?: string;
  character_refresh_period?: string;
  next_invoice?: NextInvoice;
  has_open_invoices?: boolean;
}

export interface NextInvoice {
  amount_due_cents: number;
  next_payment_attempt_unix: number;
}

// ============================================
// Voices List Response (v2 API)
// ============================================

export interface VoicesResponse {
  voices: Voice[];
  has_more?: boolean;
  next_cursor?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ElevenLabsApiErrorDetail {
  status: string;
  message: string;
}

export class ElevenLabsApiError extends Error {
  public readonly statusCode: number;
  public readonly detail?: ElevenLabsApiErrorDetail;

  constructor(message: string, statusCode: number, detail?: ElevenLabsApiErrorDetail) {
    super(message);
    this.name = 'ElevenLabsApiError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

// ============================================
// Default Settings
// ============================================

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
};

export const DEFAULT_TTS_MODEL: TTSModelId = 'eleven_multilingual_v2';
export const DEFAULT_AUDIO_FORMAT: AudioFormat = 'mp3_44100_128';
