// The Token Company API Types

export interface TheTokenCompanyConfig {
  apiKey: string;
  baseUrl?: string;
}

export type CompressionModel = 'bear-2' | 'bear-1.2';

export const COMPRESSION_MODELS: CompressionModel[] = ['bear-2', 'bear-1.2'];

export const DEFAULT_COMPRESSION_MODEL: CompressionModel = 'bear-2';

export interface CompressionSettings {
  aggressiveness?: number;
}

export interface CompressRequest {
  model?: CompressionModel | string;
  input: string;
  compression_settings?: CompressionSettings;
  app_id?: string;
}

export interface CompressResponse {
  output: string;
  output_tokens: number;
  input_tokens: number;
  tokens_saved: number;
  compression_ratio: number;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RawRequestOptions {
  method?: HttpMethod;
  path: string;
  body?: Record<string, unknown> | unknown[] | string;
  query?: Record<string, string | number | boolean | undefined>;
}

export type OutputFormat = 'json' | 'pretty';

export interface ApiErrorDetail {
  message?: string;
  type?: string;
  code?: string;
}

export class TheTokenCompanyApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: ApiErrorDetail;

  constructor(message: string, statusCode: number, error?: ApiErrorDetail) {
    super(message);
    this.name = 'TheTokenCompanyApiError';
    this.statusCode = statusCode;
    this.error = error;
  }
}
