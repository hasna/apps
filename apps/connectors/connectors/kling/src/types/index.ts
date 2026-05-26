// Kling AI Types
// TypeScript types for Kling AI video generation API

// ============================================
// Configuration
// ============================================

export interface KlingConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export type GenerationState = 'pending' | 'processing' | 'completed' | 'failed';

// ============================================
// Generation Types
// ============================================

export interface GenerationRequest {
  prompt: string;
  aspect_ratio?: AspectRatio;
  duration?: number;
  loop?: boolean;
  model?: string;
}

export interface ImageToVideoRequest {
  prompt?: string;
  keyframes: {
    frame0?: {
      type: 'image';
      url: string;
    };
    frame1?: {
      type: 'image';
      url: string;
    };
  };
  aspect_ratio?: AspectRatio;
  duration?: number;
  loop?: boolean;
  model?: string;
}

export interface GenerationAssets {
  video?: string;
  thumbnail?: string;
}

export interface Generation {
  id: string;
  state: GenerationState;
  failure_reason?: string;
  created_at: string;
  assets?: GenerationAssets;
  request: GenerationRequest | ImageToVideoRequest;
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

export class KlingApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'KlingApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
