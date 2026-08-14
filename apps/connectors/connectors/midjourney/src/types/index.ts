// Midjourney Connector Types

// ============================================
// Configuration
// ============================================

export interface MidjourneyConfig {
  apiKey: string;
  discordToken?: string; // Optional - for Discord bot automation
  baseUrl?: string;      // Override default base URL
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
// Image Generation Types
// ============================================

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ImagineJob {
  id: string;
  prompt: string;
  status: JobStatus;
  progress?: number;
  imageUrl?: string;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt?: string;
  error?: string;
}

export interface ImagineParams {
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  chaos?: number;       // 0-100, randomness
  quality?: number;     // 0.25, 0.5, 1, 2
  stylize?: number;     // 0-1000, artistic style
  seed?: number;        // For reproducibility
  tile?: boolean;       // Generate tileable pattern
  version?: string;     // Midjourney version (e.g., '5.2', '6')
  style?: 'raw' | 'cute' | 'scenic' | 'original';
  negative?: string;    // Negative prompt (--no)
}

export interface ImagineListResponse {
  jobs: ImagineJob[];
  nextPageToken?: string;
  total?: number;
}

// ============================================
// Variation & Upscale Types
// ============================================

export interface VariationParams {
  jobId: string;
  index: 1 | 2 | 3 | 4;  // Which image to vary
  type?: 'subtle' | 'strong';
}

export interface UpscaleParams {
  jobId: string;
  index: 1 | 2 | 3 | 4;  // Which image to upscale
  type?: 'subtle' | 'creative';
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class MidjourneyApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'MidjourneyApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
