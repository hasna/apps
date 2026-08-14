// SpreadsheetFile Connector Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  accessToken?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface SpreadsheetFile {
  id: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ListFilesParams {
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface ListFilesResult {
  data?: SpreadsheetFile[];
  files?: SpreadsheetFile[];
  nextCursor?: string;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface CreateFileParams {
  name?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SpreadsheetEvent {
  id: string;
  type?: string;
  fileId?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ListEventsParams {
  limit?: number;
  offset?: number;
  cursor?: string;
  fileId?: string;
}

export interface ListEventsResult {
  data?: SpreadsheetEvent[];
  events?: SpreadsheetEvent[];
  nextCursor?: string;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface SearchParams {
  query?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

export interface SearchResult {
  data?: unknown[];
  results?: unknown[];
  total?: number;
  [key: string]: unknown;
}

export interface RawRequestParams {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
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
    options?: {
      errors?: ApiErrorDetail[];
      requestId?: string;
    }
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

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Please check your SpreadsheetFile API key.';
      case 403:
        return 'Access denied. Your API key may not have the required permissions.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
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
  const errorObj = data.error as Record<string, unknown> | undefined;
  const message =
    (errorObj?.message as string) ||
    (data.message as string) ||
    (data.error as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || 'unknown'),
      message: String(e.message || 'Unknown error'),
      field: e.field as string | undefined,
    }));
  }

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new ConnectorApiError(message, statusCode, { errors, requestId });
}
