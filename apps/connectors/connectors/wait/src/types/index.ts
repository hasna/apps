// Wait Connector Types

export interface WaitConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'table' | 'pretty';

/** Loose delay record — no public OpenAPI spec available. */
export interface Delay {
  id?: string;
  [key: string]: unknown;
}

/** Loose event record — no public OpenAPI spec available. */
export interface WaitEvent {
  id?: string;
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  [key: string]: unknown;
}

export interface SearchResult {
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class WaitApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: unknown;

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message);
    this.name = 'WaitApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}
