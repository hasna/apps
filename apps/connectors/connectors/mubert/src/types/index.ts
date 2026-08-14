// Mubert AI Types
// TypeScript types for Mubert AI music generation API

// ============================================
// Configuration
// ============================================

export interface MubertConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type TrackState = 'pending' | 'processing' | 'completed' | 'failed';

// ============================================
// Track Generation Types
// ============================================

export interface TrackRequest {
  prompt: string;
  duration?: number;
  mode?: string;
  intensity?: 'low' | 'medium' | 'high';
  format?: 'mp3' | 'wav';
}

export interface TrackAssets {
  audio_url?: string;
}

export interface Track {
  id: string;
  state: TrackState;
  failure_reason?: string;
  created_at: string;
  prompt: string;
  duration?: number;
  assets?: TrackAssets;
}

export interface TracksListResponse {
  tracks: Track[];
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

export class MubertApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'MubertApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
