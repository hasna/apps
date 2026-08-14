// Luma AI API Types

export interface LumaConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface GenerationRequest {
  prompt: string;
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  loop?: boolean;
  keyframes?: {
    frame0?: { type: 'image'; url: string } | { type: 'generation'; id: string };
    frame1?: { type: 'image'; url: string } | { type: 'generation'; id: string };
  };
}

export interface ImageToVideoRequest {
  prompt?: string;
  keyframes: {
    frame0: { type: 'image'; url: string };
    frame1?: { type: 'image'; url: string };
  };
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  loop?: boolean;
}

export interface Generation {
  id: string;
  state: 'queued' | 'dreaming' | 'completed' | 'failed';
  failure_reason?: string;
  created_at: string;
  assets?: {
    video?: string;
  };
  version?: string;
  request: {
    prompt?: string;
    aspect_ratio?: string;
    loop?: boolean;
    keyframes?: object;
  };
}

export interface GenerationsListResponse {
  generations: Generation[];
  has_more: boolean;
  count: number;
}

export class LumaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'LumaApiError';
  }
}
