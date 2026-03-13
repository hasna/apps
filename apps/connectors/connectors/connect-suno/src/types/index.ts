// Suno AI Types
// TypeScript types for Suno AI music generation API

// ============================================
// Configuration
// ============================================

export interface SunoConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type GenerationState = 'pending' | 'processing' | 'completed' | 'failed';

// ============================================
// Generation Types
// ============================================

export interface GenerationRequest {
  prompt: string;
  style?: string;
  title?: string;
  make_instrumental?: boolean;
  model?: string;
}

export interface ExtendRequest {
  audio_id: string;
  prompt?: string;
  continue_at?: number;
}

export interface GenerationAssets {
  audio_url?: string;
  image_url?: string;
  video_url?: string;
}

export interface Generation {
  id: string;
  state: GenerationState;
  failure_reason?: string;
  created_at: string;
  title?: string;
  prompt: string;
  style?: string;
  duration?: number;
  assets?: GenerationAssets;
}

export interface GenerationsListResponse {
  generations: Generation[];
  has_more: boolean;
  count: number;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class SunoApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'SunoApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
