// Wordfence API Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Scans
// ============================================

export interface ListScansParams {
  limit?: number;
  offset?: number;
  status?: string;
}

export interface CreateScanParams {
  siteId?: string;
  type?: string;
  [key: string]: unknown;
}

export interface ScanSummary {
  id: string;
  status?: string;
  type?: string;
  createdAt?: string;
  completedAt?: string;
  siteId?: string;
  [key: string]: unknown;
}

export interface ScanDetail extends ScanSummary {
  results?: Record<string, unknown>;
  issues?: unknown[];
  [key: string]: unknown;
}

export interface ListScansResult {
  scans?: ScanSummary[];
  data?: ScanSummary[];
  total?: number;
  [key: string]: unknown;
}

// ============================================
// Events
// ============================================

export interface ListEventsParams {
  limit?: number;
  offset?: number;
  type?: string;
  since?: string;
  siteId?: string;
}

export interface SecurityEvent {
  id?: string;
  type?: string;
  timestamp?: string;
  message?: string;
  siteId?: string;
  severity?: string;
  [key: string]: unknown;
}

export interface ListEventsResult {
  events?: SecurityEvent[];
  data?: SecurityEvent[];
  total?: number;
  [key: string]: unknown;
}

// ============================================
// Search
// ============================================

export interface SearchParams {
  query: string;
  type?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SearchResult {
  results?: unknown[];
  data?: unknown[];
  total?: number;
  query?: string;
  [key: string]: unknown;
}

// ============================================
// API Errors
// ============================================

export interface ApiErrorDetail {
  code?: string;
  message: string;
  field?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, options?: { errors?: ApiErrorDetail[] }) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
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

  getUserMessage(): string {
    switch (this.statusCode) {
      case 400:
        return 'Bad request. Please check your input.';
      case 401:
        return 'Authentication failed. Please check your Wordfence API key.';
      case 403:
        return 'Access denied. Your API key may not have permission for this endpoint.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      case 500:
      case 502:
      case 503:
      case 504:
        return 'Service temporarily unavailable. Please try again later.';
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
  let message = `HTTP ${statusCode} Error`;
  let errors: ApiErrorDetail[] | undefined;

  if (typeof data.message === 'string') {
    message = data.message;
  } else if (typeof data.error === 'string') {
    message = data.error;
  } else if (Array.isArray(data.errors)) {
    errors = data.errors.map((e) => {
      const item = e as Record<string, unknown>;
      return {
        code: item.code ? String(item.code) : undefined,
        message: String(item.message || item.detail || 'Unknown error'),
        field: item.field ? String(item.field) : undefined,
      };
    });
    message = errors.map((e) => e.message).join('; ');
  }

  return new ConnectorApiError(message, statusCode, { errors });
}
