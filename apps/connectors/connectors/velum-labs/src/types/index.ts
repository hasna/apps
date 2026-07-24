export interface VelumLabsConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface Dataset {
  id: string;
  name?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Event {
  id: string;
  type?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SearchRequest {
  query: string;
  dataset_id?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: unknown[];
  total?: number;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class VelumLabsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'VelumLabsApiError';
  }
}
