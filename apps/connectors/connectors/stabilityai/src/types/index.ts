// Stability AI API Types
// AI-powered image generation, editing, and 3D model creation

// ============================================
// Configuration
// ============================================

export interface StabilityConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// User/Account Types
// ============================================

export interface UserAccount {
  id: string;
  email: string;
  profile_picture?: string;
}

export interface UserBalance {
  credits: number;
}

// ============================================
// Engine Types
// ============================================

export interface Engine {
  id: string;
  name: string;
  description: string;
  type: EngineType;
}

export type EngineType = 'AUDIO' | 'CLASSIFICATION' | 'PICTURE' | 'STORAGE' | 'TEXT' | 'VIDEO';

// ============================================
// Text-to-Image Types
// ============================================

export type StylePreset =
  | '3d-model'
  | 'analog-film'
  | 'anime'
  | 'cinematic'
  | 'comic-book'
  | 'digital-art'
  | 'enhance'
  | 'fantasy-art'
  | 'isometric'
  | 'line-art'
  | 'low-poly'
  | 'modeling-compound'
  | 'neon-punk'
  | 'origami'
  | 'photographic'
  | 'pixel-art'
  | 'tile-texture';

export type AspectRatio =
  | '16:9'
  | '1:1'
  | '21:9'
  | '2:3'
  | '3:2'
  | '4:5'
  | '5:4'
  | '9:16'
  | '9:21';

export type OutputFormatImage = 'jpeg' | 'png' | 'webp';

export interface TextToImageOptions {
  prompt: string;
  model?: string;
  negativePrompt?: string;
  aspectRatio?: AspectRatio;
  seed?: number;
  outputFormat?: OutputFormatImage;
  stylePreset?: StylePreset;
  // v1 specific
  cfgScale?: number;
  height?: number;
  width?: number;
  samples?: number;
  steps?: number;
}

export interface GenerationArtifact {
  base64: string;
  seed: number;
  finishReason: 'SUCCESS' | 'CONTENT_FILTERED' | 'ERROR';
  contentFiltered?: boolean;
}

export interface TextToImageResponse {
  artifacts?: GenerationArtifact[];
  // v2 response format
  image?: string;
  seed?: number;
  finish_reason?: string;
}

// ============================================
// Image-to-Image Types
// ============================================

export interface ImageToImageOptions {
  image: string | Buffer; // File path or buffer
  prompt: string;
  model?: string;
  negativePrompt?: string;
  strength?: number; // 0-1, how much to transform
  seed?: number;
  outputFormat?: OutputFormatImage;
  stylePreset?: StylePreset;
  // v1 specific
  cfgScale?: number;
  samples?: number;
  steps?: number;
  mode?: 'image-to-image' | 'image-to-image-masking';
}

export interface ImageToImageResponse {
  artifacts?: GenerationArtifact[];
  image?: string;
  seed?: number;
  finish_reason?: string;
}

// ============================================
// Inpainting Types
// ============================================

export interface InpaintOptions {
  image: string | Buffer;
  mask: string | Buffer;
  prompt: string;
  model?: string;
  negativePrompt?: string;
  seed?: number;
  outputFormat?: OutputFormatImage;
  growMask?: number;
  // v1 specific
  cfgScale?: number;
  samples?: number;
  steps?: number;
}

export interface InpaintResponse {
  artifacts?: GenerationArtifact[];
  image?: string;
  seed?: number;
  finish_reason?: string;
}

// ============================================
// Outpainting Types
// ============================================

export type OutpaintDirection = 'left' | 'right' | 'up' | 'down';

export interface OutpaintOptions {
  image: string | Buffer;
  prompt?: string;
  negativePrompt?: string;
  left?: number;
  right?: number;
  up?: number;
  down?: number;
  creativity?: number; // 0-1
  seed?: number;
  outputFormat?: OutputFormatImage;
}

export interface OutpaintResponse {
  image: string;
  seed: number;
  finish_reason: string;
}

// ============================================
// Upscale Types
// ============================================

export type UpscaleMode = 'conservative' | 'creative' | 'fast';

export interface UpscaleOptions {
  image: string | Buffer;
  prompt?: string;
  negativePrompt?: string;
  outputFormat?: OutputFormatImage;
  seed?: number;
  creativity?: number;
  // Creative upscale specific
  style?: StylePreset;
  // Fast upscale - no additional options needed
}

export interface UpscaleResponse {
  image: string;
  seed?: number;
  finish_reason: string;
}

// ============================================
// Edit Types
// ============================================

export interface EraseOptions {
  image: string | Buffer;
  mask?: string | Buffer;
  growMask?: number;
  seed?: number;
  outputFormat?: OutputFormatImage;
}

export interface SearchAndReplaceOptions {
  image: string | Buffer;
  prompt: string;
  searchPrompt: string;
  negativePrompt?: string;
  seed?: number;
  outputFormat?: OutputFormatImage;
  growMask?: number;
}

export interface RemoveBackgroundOptions {
  image: string | Buffer;
  outputFormat?: OutputFormatImage;
}

export interface ReplaceBackgroundOptions {
  image: string | Buffer;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  outputFormat?: OutputFormatImage;
}

export interface EditResponse {
  image: string;
  seed?: number;
  finish_reason: string;
}

// ============================================
// 3D Types
// ============================================

export interface StableFast3DOptions {
  image: string | Buffer;
  textureResolution?: 512 | 1024 | 2048;
  foregroundRatio?: number; // 0.1-1.0
  remesh?: 'none' | 'triangle' | 'quad';
  vertexCount?: number; // For triangle/quad remesh
}

export interface StableFast3DResponse {
  glb: string; // Base64 encoded GLB file
}

export interface StableVideo3DOptions {
  image: string | Buffer;
  textureResolution?: 512 | 1024 | 2048;
  foregroundRatio?: number;
  remesh?: 'none' | 'triangle' | 'quad';
  vertexCount?: number;
}

export interface StableVideo3DResponse {
  glb: string;
}

// ============================================
// Result Types (for async operations)
// ============================================

export interface GenerationResult {
  id: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  result?: string; // Base64 image
  error?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  id: string;
  name: string;
  message: string;
}

export class StabilityApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'StabilityApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
