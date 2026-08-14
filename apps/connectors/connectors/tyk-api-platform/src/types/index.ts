export interface TykApiPlatformConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export class TykApiPlatformApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'TykApiPlatformApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface Item {
  id?: string;
  [key: string]: unknown;
}

export interface Event {
  id?: string;
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}
