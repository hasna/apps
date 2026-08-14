// Hedra Connector Types
// TypeScript types for the Hedra AI video generation API

// ============================================
// Configuration
// ============================================

export interface HedraConfig {
  apiKey: string;
  apiSecret?: string; // Optional - if Hedra requires it in the future
  baseUrl?: string;   // Override default base URL
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  nextToken?: string;
  hasMore: boolean;
}

// ============================================
// Character Types
// ============================================

export interface HedraCharacter {
  id: string;
  name: string;
  avatarUrl?: string;
  voiceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HedraCharacterCreateParams {
  name: string;
  avatarUrl?: string;
  voiceId?: string;
}

// ============================================
// Voice Types
// ============================================

export interface HedraVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  previewUrl?: string;
}

// ============================================
// Project Types
// ============================================

export interface HedraProject {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  text: string;
  characterId?: string;
  voiceId?: string;
  aspectRatio?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  createdAt: string;
  updatedAt: string;
}

export interface HedraProjectCreateParams {
  text: string;
  characterId?: string;
  voiceId?: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  audioUrl?: string; // Optional: use custom audio instead of TTS
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class HedraApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'HedraApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
