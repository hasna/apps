export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface Batch {
  id: string;
  name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface BatchListResponse {
  batches?: Batch[];
  data?: Batch[];
  [key: string]: unknown;
}

export interface Event {
  id: string;
  type?: string;
  batch_id?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface EventListResponse {
  events?: Event[];
  data?: Event[];
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: unknown[];
  data?: unknown[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;

  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export function parseApiError(data: unknown, status: number): ConnectorApiError {
  let message = `API request failed with status ${status}`;
  let body: string | undefined;

  if (typeof data === 'string') {
    message = data || message;
    body = data;
  } else if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.message === 'string') {
      message = record.message;
    } else if (typeof record.error === 'string') {
      message = record.error;
    }
    body = JSON.stringify(data);
  }

  return new ConnectorApiError(message, status, body);
}
