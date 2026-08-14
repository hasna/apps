// Tito (ti.to) Admin API v3 types

export interface TitoConfig {
  apiToken?: string;
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

export interface Ticket {
  slug: string;
  reference?: string;
  state?: string;
  release_slug?: string;
  registration_slug?: string;
  name?: string;
  email?: string;
  company_name?: string;
  phone_number?: string;
  responses?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Registration {
  slug: string;
  state?: string;
  email?: string;
  name?: string;
  company_name?: string;
  phone_number?: string;
  total?: number;
  currency?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Release {
  slug: string;
  title?: string;
  state?: string;
  price?: number;
  currency?: string;
  quantity?: number;
  tickets_count?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface CheckinList {
  slug: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface HelloResponse {
  account?: {
    slug?: string;
    name?: string;
  };
  [key: string]: unknown;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class TitoApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, options?: { errors?: ApiErrorDetail[]; requestId?: string }) {
    super(message);
    this.name = 'TitoApiError';
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
        return 'Authentication failed. Check your Tito API token.';
      case 403:
        return 'Access denied for this Tito resource.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      default:
        return this.message;
    }
  }
}

export function parseApiError(response: unknown, statusCode: number): TitoApiError {
  if (typeof response === 'string') {
    return new TitoApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new TitoApiError(`HTTP ${statusCode} Error`, statusCode);
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
      field: e.field as string | undefined,
    }));
  }

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new TitoApiError(message, statusCode, { errors, requestId });
}

/** @deprecated Use TitoConfig */
export type ConnectorConfig = TitoConfig;

/** @deprecated Use TitoApiError */
export { TitoApiError as ConnectorApiError };
