// Leonardo AI Connector Types

// ============================================
// Configuration
// ============================================

export interface LeonardoConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Generation Types
// ============================================

export interface GenerateRequest {
  prompt: string;
  modelId?: string;
  width?: number;
  height?: number;
  num_images?: number;
  guidance_scale?: number;
  negative_prompt?: string;
  seed?: number;
  presetStyle?: string;
  public?: boolean;
  scheduler?: string;
  alchemy?: boolean;
  photoReal?: boolean;
  photoRealVersion?: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
  likeCount?: number;
  nsfw?: boolean;
}

export interface Generation {
  id: string;
  status: 'PENDING' | 'COMPLETE' | 'FAILED';
  prompt: string;
  modelId?: string;
  imageWidth?: number;
  imageHeight?: number;
  generated_images: GeneratedImage[];
  createdAt: string;
}

export interface GenerateResponse {
  sdGenerationJob: {
    generationId: string;
  };
}

export interface GetGenerationResponse {
  generations_by_pk: Generation;
}

export interface ListGenerationsResponse {
  generations: Generation[];
}

// ============================================
// Model Types
// ============================================

export interface Model {
  id: string;
  name: string;
  description?: string;
  modelWidth?: number;
  modelHeight?: number;
  type?: string;
  nsfw?: boolean;
  public?: boolean;
  generated_image?: {
    url: string;
  };
}

export interface ListModelsResponse {
  custom_models: Model[];
}

export interface PlatformModel {
  id: string;
  name: string;
  description?: string;
  generated_image?: {
    url: string;
  };
}

export interface ListPlatformModelsResponse {
  platform_models: PlatformModel[];
}

// ============================================
// Variation Types
// ============================================

export interface VariationRequest {
  id: string;
  isVariation?: boolean;
  transformType?: 'OUTPAINT' | 'INPAINT' | 'UPSCALE' | 'UNZOOM';
}

export interface VariationResponse {
  sdGenerationJob: {
    generationId: string;
  };
}

// ============================================
// User Types
// ============================================

export interface UserInfo {
  user: {
    id: string;
    username: string;
    tokenRenewalDate: string;
    subscriptionTokens: number;
    subscriptionGptTokens: number;
    subscriptionModelTokens: number;
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

export class LeonardoApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'LeonardoApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
