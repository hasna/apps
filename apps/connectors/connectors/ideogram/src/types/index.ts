// Ideogram AI Types
// TypeScript types for Ideogram AI image generation API

// ============================================
// Configuration
// ============================================

export interface IdeogramConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';

export type StyleType = 'auto' | 'general' | 'realistic' | 'design' | 'render_3d' | 'anime';

// ============================================
// Generation Types
// ============================================

export interface GenerateRequest {
  prompt: string;
  aspect_ratio?: AspectRatio;
  style_type?: StyleType;
  negative_prompt?: string;
  seed?: number;
  model?: string;
}

export interface GeneratedImage {
  url: string;
  seed: number;
  is_image_safe: boolean;
}

export interface GenerateResponse {
  created: string;
  data: GeneratedImage[];
}

export interface DescribeRequest {
  image_url: string;
}

export interface DescribeResponse {
  descriptions: {
    text: string;
    confidence: number;
  }[];
}

export interface RemixRequest {
  prompt: string;
  image_url: string;
  aspect_ratio?: AspectRatio;
  style_type?: StyleType;
  image_weight?: number;
  seed?: number;
}

export interface UpscaleRequest {
  image_url: string;
  scale?: number;
}

export interface UpscaleResponse {
  url: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class IdeogramApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'IdeogramApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
