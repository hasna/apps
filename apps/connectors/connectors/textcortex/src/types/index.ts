// TextCortex API Types

export interface TextCortexConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface GenerateTextRequest {
  prompt: string;
  max_tokens?: number;
  model?: string;
  temperature?: number;
  [key: string]: unknown;
}

export interface SummarizeTextRequest {
  text: string;
  max_tokens?: number;
  mode?: string;
  [key: string]: unknown;
}

export interface RewriteTextRequest {
  text: string;
  mode?: string;
  max_tokens?: number;
  [key: string]: unknown;
}

export interface ClassifyTextRequest {
  text: string;
  labels?: string[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
}

export interface TextCortexResponse {
  data?: {
    outputs?: Array<{ text?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  message?: string;
  [key: string]: unknown;
}

export type OutputFormat = 'json' | 'pretty';

export class TextCortexApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'TextCortexApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
