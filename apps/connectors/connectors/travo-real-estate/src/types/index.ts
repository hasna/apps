// Travo Data connector types

export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface Listing {
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
  query?: QueryParams;
  body?: Record<string, unknown> | unknown[] | string;
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

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode, response);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode, JSON.stringify(response));
}
