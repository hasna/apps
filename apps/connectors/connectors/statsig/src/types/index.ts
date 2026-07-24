// Statsig Console API Types
// @see https://docs.statsig.com/console-api/introduction

export interface StatsigConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

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

export type OutputFormat = 'json' | 'pretty';

export type JsonRecord = Record<string, unknown>;

export interface StatsigListResponse<T = JsonRecord> {
  data?: T[];
  message?: string;
}

export interface StatsigResourceResponse<T = JsonRecord> {
  data?: T;
  message?: string;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class StatsigApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly requestId?: string;

  constructor(
    message: string,
    statusCode: number,
    options?: { errors?: ApiErrorDetail[]; requestId?: string },
  ) {
    super(message);
    this.name = 'StatsigApiError';
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
        return 'Authentication failed. Check your STATSIG_API_KEY.';
      case 403:
        return 'Access denied for this Statsig resource.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Retry after a short delay.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): StatsigApiError {
  if (typeof response === 'string') {
    return new StatsigApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new StatsigApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || 'unknown'),
      message: String(e.message || 'Unknown error'),
      field: e.field as string | undefined,
    }));
  }

  const requestId = (data.request_id as string) || (data.requestId as string);

  return new StatsigApiError(message, statusCode, { errors, requestId });
}
