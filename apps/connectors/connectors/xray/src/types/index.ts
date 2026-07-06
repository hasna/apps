// Xray API Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface Scan {
  id: string;
  name?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Event {
  id: string;
  type?: string;
  scanId?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ListScansParams {
  limit?: number;
  offset?: number;
  status?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface CreateScanParams {
  name?: string;
  [key: string]: unknown;
}

export interface ListEventsParams {
  limit?: number;
  offset?: number;
  scanId?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface SearchParams {
  query?: string;
  type?: string;
  [key: string]: unknown;
}

export interface RawRequestParams {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (typeof data.message === 'string' && data.message) ||
    (typeof data.error === 'string' && data.error) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode);
}
