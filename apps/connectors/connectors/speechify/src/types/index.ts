// Speechify API Types

// ============================================
// Configuration
// ============================================

export interface SpeechifyConfig {
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

export interface Voice {
  id: string;
  name: string;
  type: 'personal' | 'shared' | 'professional';
  gender?: 'male' | 'female';
  language?: string;
  locale?: string;
  preview_url?: string;
  sample_url?: string;
  is_cloned?: boolean;
  created_at?: string;
}

export interface VoicesListResponse {
  voices: Voice[];
}

export interface VoiceResponse {
  voice: Voice;
}

// ============================================
// Speech Generation Types
// ============================================

export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'aac';

export interface GenerateSpeechOptions {
  voice_id: string;
  input: string;
  audio_format?: AudioFormat;
  sample_rate?: number;
  speed?: number; // 0.5 to 2.0
  pitch?: number; // -20 to 20
}

export interface GenerateSpeechResponse {
  audio_data: string; // base64 encoded
  audio_format: string;
  duration_seconds?: number;
  characters_used?: number;
}

export interface StreamSpeechOptions {
  voice_id: string;
  input: string;
  audio_format?: AudioFormat;
  sample_rate?: number;
  speed?: number;
  pitch?: number;
}

// ============================================
// Voice Cloning Types
// ============================================

export interface CloneVoiceOptions {
  name: string;
  sample_url?: string;
  description?: string;
}

export interface CloneVoiceResponse {
  voice: Voice;
}

export interface DeleteVoiceResponse {
  success: boolean;
}

// ============================================
// Usage Types
// ============================================

export interface UsageResponse {
  characters_used: number;
  characters_limit: number;
  period_start: string;
  period_end: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class SpeechifyApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'SpeechifyApiError';
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
