// fal.ai Connector Types

// ============================================
// Configuration
// ============================================

export interface FalConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Image Generation Types
// ============================================

export interface ImageGenerateRequest {
  prompt: string;
  image_size?: string | { width: number; height: number };
  num_inference_steps?: number;
  guidance_scale?: number;
  num_images?: number;
  seed?: number;
  enable_safety_checker?: boolean;
  sync_mode?: boolean;
}

export interface GeneratedImage {
  url: string;
  width: number;
  height: number;
  content_type: string;
}

export interface ImageGenerateResponse {
  images: GeneratedImage[];
  timings?: {
    inference: number;
  };
  seed?: number;
  has_nsfw_concepts?: boolean[];
  prompt?: string;
}

// ============================================
// Queue Types
// ============================================

export interface QueueSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

export interface QueueStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  request_id: string;
  response_url?: string;
  logs?: Array<{
    message: string;
    timestamp: string;
  }>;
  metrics?: {
    inference_time?: number;
  };
}

export interface QueueResultResponse<T = unknown> {
  status: 'COMPLETED' | 'FAILED';
  request_id: string;
  response?: T;
  error?: string;
}

// ============================================
// Run Options
// ============================================

export interface RunOptions {
  model: string;
  input: Record<string, unknown>;
  webhookUrl?: string;
}

// ============================================
// Model Info Types
// ============================================

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  owner?: string;
}

// ============================================
// Common Models
// ============================================

export const COMMON_MODELS = {
  // FLUX models
  'flux-dev': 'fal-ai/flux/dev',
  'flux-schnell': 'fal-ai/flux/schnell',
  'flux-pro': 'fal-ai/flux-pro',
  'flux-pro-1.1': 'fal-ai/flux-pro/v1.1',
  // Stable Diffusion
  'sd3-medium': 'fal-ai/stable-diffusion-v3-medium',
  'sdxl': 'fal-ai/fast-sdxl',
  // Other
  'aura-flow': 'fal-ai/aura-flow',
  'recraft-v3': 'fal-ai/recraft-v3',
} as const;

export type CommonModelAlias = keyof typeof COMMON_MODELS;

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class FalApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'FalApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
