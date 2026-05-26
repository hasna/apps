// Resemble AI API Types

// ============================================
// Configuration
// ============================================

export interface ResembleConfig {
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
  uuid: string;
  name: string;
  status: 'ready' | 'processing' | 'failed';
  is_public?: boolean;
  created_at: string;
  updated_at: string;
}

export interface VoicesListResponse {
  success: boolean;
  page: number;
  num_pages: number;
  items: Voice[];
}

export interface VoiceResponse {
  success: boolean;
  item: Voice;
}

export interface CreateVoiceOptions {
  name: string;
  dataset_url?: string;
  callback_uri?: string;
}

// ============================================
// Project Types
// ============================================

export interface Project {
  uuid: string;
  name: string;
  description?: string;
  is_public?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectsListResponse {
  success: boolean;
  page: number;
  num_pages: number;
  items: Project[];
}

export interface ProjectResponse {
  success: boolean;
  item: Project;
}

// ============================================
// Clip Types (Speech Generation)
// ============================================

export interface Clip {
  uuid: string;
  title?: string;
  body: string;
  voice_uuid: string;
  is_public?: boolean;
  is_archived?: boolean;
  audio_src?: string;
  raw_audio_src?: string;
  created_at: string;
  updated_at: string;
}

export interface ClipsListResponse {
  success: boolean;
  page: number;
  num_pages: number;
  items: Clip[];
}

export interface ClipResponse {
  success: boolean;
  item: Clip;
}

export interface CreateClipOptions {
  voice_uuid: string;
  body: string;
  title?: string;
  is_public?: boolean;
  is_archived?: boolean;
  callback_uri?: string;
  precision?: 'PCM_16' | 'PCM_24' | 'PCM_32' | 'MULAW';
  sample_rate?: number;
  output_format?: 'wav' | 'mp3';
}

export interface SyncClipResponse {
  success: boolean;
  item: {
    uuid: string;
    audio_src: string;
    raw_audio_src?: string;
  };
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ResembleApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ResembleApiError';
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
