// Tettra Api Platform API types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ListParams {
  [key: string]: string | number | boolean | undefined;
}

/** Generic item record — API shapes are permissive until live docs are available. */
export interface Item {
  id?: string;
  [key: string]: unknown;
}

/** Generic event record. */
export interface Event {
  id?: string;
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  [key: string]: unknown;
}

export type SearchResponse = Record<string, unknown>;
export type ItemsListResponse = Item[] | Record<string, unknown>;
export type EventsListResponse = Event[] | Record<string, unknown>;
export type ItemResponse = Item | Record<string, unknown>;

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: ListParams;
  body?: unknown;
  headers?: Record<string, string>;
}

export class ConnectorApiError extends Error {
  readonly statusCode: number;
  readonly body?: unknown;

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.body = body;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseApiError(data: unknown, status: number): ConnectorApiError {
  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    const message =
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.error === 'string' && obj.error) ||
      JSON.stringify(data);
    return new ConnectorApiError(message, status, data);
  }
  return new ConnectorApiError(String(data || 'Request failed'), status, data);
}
