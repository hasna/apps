// Synphony API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  /** API key sent as a Bearer token */
  apiKey?: string;
  /** Alias for apiKey */
  token?: string;
  /** Override the API base URL (defaults to https://api.synphony.ai/v1) */
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

/** Common query options for list endpoints. */
export interface ListParams {
  /** Free-form query parameters passed through to the API. */
  [key: string]: string | number | boolean | undefined;
}

/** Options for the raw-request escape hatch. */
export interface RawRequestParams {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

// ============================================
// Domain Types
//
// The Synphony API is not publicly documented; these interfaces describe the
// commonly observed response fields and remain open (index signature) so that
// additional fields returned by the API are preserved rather than dropped.
// ============================================

export interface Farm {
  id?: string;
  name?: string;
  location?: string;
  timezone?: string;
  bedCount?: number;
  robotCount?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Robot {
  id?: string;
  farmId?: string;
  name?: string;
  model?: string;
  status?: string;
  batteryLevel?: number;
  firmwareVersion?: string;
  lastSeenAt?: string;
  [key: string]: unknown;
}

export interface Telemetry {
  robotId?: string;
  timestamp?: string;
  batteryLevel?: number;
  position?: {
    lat?: number;
    lng?: number;
    bed?: string;
  };
  metrics?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface HarvestRun {
  id?: string;
  farmId?: string;
  robotId?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  yield?: number;
  unit?: string;
  [key: string]: unknown;
}

export interface BedAnalytics {
  farmId?: string;
  bedId?: string;
  metrics?: Record<string, unknown>;
  period?: {
    from?: string;
    to?: string;
  };
  [key: string]: unknown;
}

/** A list response. Synphony endpoints may return either a bare array or an
 * envelope with a `data` array; both shapes are passed through untouched. */
export type ListResponse<T> = T[] | { data?: T[]; [key: string]: unknown };

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code?: string;
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

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
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
        return 'Authentication failed. Please check your Synphony API key.';
      case 403:
        return 'Access denied. Your API key may not have access to this resource.';
      case 404:
        return 'Resource not found.';
      case 422:
        return 'Invalid parameters. Please check your input.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      case 500:
        return 'Server error. Please try again later.';
      case 502:
      case 503:
      case 504:
        return 'Service temporarily unavailable. Please try again later.';
      default:
        return this.message;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errors: this.errors,
      requestId: this.requestId,
    };
  }
}

export function parseApiError(
  response: unknown,
  statusCode: number
): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response || `HTTP ${statusCode} Error`, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  const errorObj = data.error as Record<string, unknown> | undefined;
  const message =
    (errorObj?.message as string) ||
    (data.message as string) ||
    (typeof data.error === 'string' ? (data.error as string) : undefined) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode);
}
