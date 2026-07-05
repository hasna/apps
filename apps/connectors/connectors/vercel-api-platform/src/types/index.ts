// Vercel Api Platform types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  accessToken?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ListParams {
  [key: string]: string | number | boolean | undefined;
}

export type PlatformItem = Record<string, unknown> & {
  id?: string;
};

export interface ItemsListResponse {
  items?: PlatformItem[];
  data?: PlatformItem[];
  [key: string]: unknown;
}

export interface EventsListResponse {
  events?: Record<string, unknown>[];
  data?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: Record<string, unknown>[];
  data?: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: HttpMethod;
  path: string;
  query?: ListParams;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: { errors?: ApiErrorDetail[]; requestId?: string }
  ) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.requestId = options?.requestId;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
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
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || e.error || 'unknown'),
      message: String(e.message || e.description || 'Unknown error'),
      field: e.field as string,
    }));
  }

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new ConnectorApiError(message, statusCode, { errors, requestId });
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}
