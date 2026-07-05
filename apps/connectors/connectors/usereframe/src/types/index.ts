export type OutputFormat = 'json' | 'pretty';

export interface UsereframeConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface QueryParams {
  [key: string]: string | number | boolean | undefined;
}

export interface RawRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: QueryParams;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class UsereframeApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'UsereframeApiError';
    this.statusCode = statusCode;
  }
}

export function parseApiError(response: unknown, statusCode: number): UsereframeApiError {
  if (typeof response === 'string') {
    return new UsereframeApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new UsereframeApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  return new UsereframeApiError(message, statusCode);
}
