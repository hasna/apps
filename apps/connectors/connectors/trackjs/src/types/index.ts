// TrackJS Data API Types

export interface TrackjsConfig {
  apiKey: string;
  customerId: string;
  baseUrl?: string;
  /** Use `key` query parameter instead of Authorization header */
  useKeyQueryParam?: boolean;
}

export type OutputFormat = 'json' | 'pretty';

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

export interface TrackjsMetadata {
  startDate?: string;
  endDate?: string;
  totalCount?: number;
  page: number;
  size: number;
  hasMore: boolean;
  trackJsUrl?: string;
}

export interface TrackjsPaginatedResponse<T> {
  data: T[];
  metadata: TrackjsMetadata;
}

export interface TrackjsErrorMetadata {
  key: string;
  value: string;
}

export interface TrackjsError {
  message: string;
  timestamp: string;
  url: string;
  id: string;
  browserName?: string;
  browserVersion?: string;
  entry?: string;
  line?: number;
  column?: number;
  file?: string;
  userId?: string;
  sessionId?: string;
  status?: string;
  trackJsUrl?: string;
  stackTrace?: string[];
  metadata?: TrackjsErrorMetadata[];
}

export interface TrackjsAggregateEntry {
  key: string;
  count: number;
  userCount: number;
  lastSeen?: string;
  status?: string;
  trackJsUrl?: string;
}

export interface TrackjsDateAggregateEntry {
  key: string;
  count: number;
  userCount: number;
  trackJsUrl?: string;
}

export interface ErrorsListParams {
  application?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  size?: number;
  query?: string;
  includeStack?: boolean;
}

export interface ErrorsAggregateParams {
  application?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  size?: number;
  sort?: string;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export class TrackjsApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, options?: { errors?: ApiErrorDetail[] }) {
    super(message);
    this.name = 'TrackjsApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 401:
        return 'Authentication failed. Check TRACKJS_API_KEY and TRACKJS_CUSTOMER_ID (account owner only).';
      case 403:
        return 'Access denied. TrackJS Data API credentials are limited to account owners.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): TrackjsApiError {
  if (typeof response === 'string' && response.trim()) {
    return new TrackjsApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new TrackjsApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message = typeof data.message === 'string'
    ? data.message
    : typeof data.error === 'string'
      ? data.error
      : `HTTP ${statusCode} Error`;

  return new TrackjsApiError(message, statusCode);
}
