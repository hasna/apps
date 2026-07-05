export interface VeoConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface VeoVideo {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface VeoUser {
  id: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

export interface VeoGroup {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface VeoTranscript {
  videoId?: string;
  segments?: Array<Record<string, unknown>>;
  text?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class VeoApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'VeoApiError';
    this.statusCode = statusCode;
  }
}
