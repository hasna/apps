export interface SprinklrConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

export interface SprinklrCase {
  id?: string;
  [key: string]: unknown;
}

export interface SprinklrEvent {
  id?: string;
  [key: string]: unknown;
}

export interface SprinklrListResponse<T> {
  data?: T[];
  items?: T[];
  results?: T[];
  total?: number;
  [key: string]: unknown;
}

export interface SprinklrSearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export class SprinklrApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'SprinklrApiError';
    this.status = status;
    this.code = code;
  }
}
