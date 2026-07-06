export interface VoygrConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface SignupParams {
  email: string;
  name?: string;
}

export interface RecoverParams {
  email: string;
}

export interface BusinessStatusParams {
  name: string;
  address: string;
}

export interface SignupResult {
  message?: string;
  api_key?: string;
  [key: string]: unknown;
}

export interface RecoverResult {
  message?: string;
  [key: string]: unknown;
}

export interface BusinessStatusResult {
  status?: string;
  name?: string;
  address?: string;
  [key: string]: unknown;
}

export interface UsageResult {
  usage?: number;
  limit?: number;
  period?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  authenticated?: boolean;
}

export type OutputFormat = 'json' | 'pretty';

export class VoygrApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'VoygrApiError';
    this.statusCode = statusCode;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseApiError(response: unknown, statusCode: number): VoygrApiError {
  if (typeof response === 'string') {
    return new VoygrApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new VoygrApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message = extractErrorMessage(data) || `HTTP ${statusCode} Error`;

  return new VoygrApiError(message, statusCode);
}

function extractErrorMessage(data: Record<string, unknown>): string | undefined {
  for (const key of ['message', 'error', 'detail']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (value && typeof value === 'object') {
      const nested = extractErrorMessage(value as Record<string, unknown>);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}
