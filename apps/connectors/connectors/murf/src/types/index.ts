// Murf AI API Types

// ============================================
// Configuration
// ============================================

export interface MurfConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Voice Types
// ============================================

export type VoiceGender = 'male' | 'female';
export type VoiceAge = 'adult' | 'middle-aged' | 'old' | 'young';

export interface Voice {
  voice_id: string;
  name: string;
  display_name: string;
  gender: VoiceGender;
  age: VoiceAge;
  language: string;
  accent?: string;
  sample_url?: string;
  is_premium?: boolean;
  styles?: string[];
}

export interface VoicesListResponse {
  voices: Voice[];
}

// ============================================
// Speech Generation Types
// ============================================

export type AudioFormat = 'mp3' | 'wav' | 'flac' | 'aac';

export interface GenerateSpeechOptions {
  voice_id: string;
  text: string;
  format?: AudioFormat;
  sample_rate?: number;
  speed?: number; // 0.5 to 2.0
  pitch?: number; // -10 to 10
  style?: string;
  model_version?: string;
}

export interface GenerateSpeechResponse {
  audio_file: string; // URL to audio file
  duration_seconds?: number;
  audio_length_bytes?: number;
  encoded_audio?: string; // base64 encoded audio data
}

export interface SpeechStatusResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audio_file?: string;
  error?: string;
}

// ============================================
// Language Types
// ============================================

export interface Language {
  code: string;
  name: string;
  native_name?: string;
}

export interface LanguagesListResponse {
  languages: Language[];
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class MurfApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'MurfApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// ============================================
// Profile Config
// ============================================

export interface ProfileConfig {
  apiKey?: string;
}
