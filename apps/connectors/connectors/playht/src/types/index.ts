// PlayHT API Types

// ============================================
// Configuration
// ============================================

export interface PlayHTConfig {
  apiKey: string;
  userId: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Voice Types
// ============================================

export type VoiceEngine = 'PlayHT2.0' | 'PlayHT2.0-turbo' | 'PlayHT1.0' | 'Standard';

export interface Voice {
  id: string;
  name: string;
  sample?: string;
  accent?: string;
  age?: string;
  gender?: string;
  language?: string;
  language_code?: string;
  loudness?: string;
  style?: string;
  tempo?: string;
  texture?: string;
  is_cloned?: boolean;
  voice_engine?: VoiceEngine;
}

export interface VoicesListResponse {
  voices: Voice[];
}

export interface ClonedVoice {
  id: string;
  name: string;
  type: 'instant' | 'cloned';
  created_at?: string;
}

export interface ClonedVoicesResponse {
  voices: ClonedVoice[];
}

// ============================================
// Speech Generation Types
// ============================================

export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'flac' | 'mulaw';

export interface GenerateSpeechOptions {
  text: string;
  voice: string;
  output_format?: AudioFormat;
  voice_engine?: VoiceEngine;
  quality?: 'draft' | 'low' | 'medium' | 'high' | 'premium';
  speed?: number; // 0.5 to 2.0
  sample_rate?: number;
  seed?: number;
  temperature?: number;
}

export interface GenerateSpeechResponse {
  id: string;
  status: string;
  url?: string;
  audio_data?: string; // base64 for streaming
  duration?: number;
  created_at?: string;
}

export interface StreamSpeechOptions {
  text: string;
  voice: string;
  output_format?: AudioFormat;
  voice_engine?: VoiceEngine;
  quality?: 'draft' | 'low' | 'medium' | 'high' | 'premium';
  speed?: number;
}

// ============================================
// Voice Cloning Types
// ============================================

export interface CloneVoiceOptions {
  voice_name: string;
  sample_file_url?: string;
  mime_type?: string;
}

export interface InstantCloneOptions {
  voice_name: string;
  sample_file_url: string;
}

export interface CloneVoiceResponse {
  id: string;
  name: string;
  status: string;
}

export interface DeleteVoiceResponse {
  success: boolean;
  message?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class PlayHTApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'PlayHTApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

// ============================================
// Profile Config
// ============================================

export interface ProfileConfig {
  apiKey?: string;
  userId?: string;
}
