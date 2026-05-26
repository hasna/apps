// Pika API Types

export interface PikaConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface GenerateVideoRequest {
  promptText: string;
  style?: string;
  aspectRatio?: string;
  negativePrompt?: string;
  seed?: number;
  guidanceScale?: number;
}

export interface ImageToVideoRequest {
  promptImage: string;
  promptText?: string;
  style?: string;
  motion?: number;
  guidanceScale?: number;
  negativePrompt?: string;
  seed?: number;
}

export interface VideoGeneration {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  progress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface GenerateResponse {
  id: string;
}

export interface GenerationListResponse {
  generations: VideoGeneration[];
}

export class PikaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'PikaApiError';
  }
}
