// TheHiveProject API Types
// Security case management platform for self-hosted TheHive instances.

export interface TheHiveProjectConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
  organisation?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ListQueryParams {
  [key: string]: string | number | boolean | undefined;
}

export interface CaseCreateBody {
  title?: string;
  description?: string;
  severity?: number;
  tags?: string[];
  [key: string]: unknown;
}

export interface QueryBody {
  query: unknown[] | Record<string, unknown>;
  [key: string]: unknown;
}

export type CaseQueryBody = QueryBody;
export type SearchBody = QueryBody;

export interface CustomEventBody {
  title?: string;
  message?: string;
  date?: number;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  params?: ListQueryParams;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  resource?: string;
}

export class TheHiveProjectApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly documentationUrl?: string;
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: {
      errors?: ApiErrorDetail[];
      documentationUrl?: string;
      requestId?: string;
    }
  ) {
    super(message);
    this.name = 'TheHiveProjectApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.documentationUrl = options?.documentationUrl;
    this.requestId = options?.requestId;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Please check your API key.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): TheHiveProjectApiError {
  if (typeof response === 'string') {
    return new TheHiveProjectApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new TheHiveProjectApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  return new TheHiveProjectApiError(message, statusCode);
}
