// AdRoll / NextRoll API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;      // Personal Access Token
  token?: string;       // Alias for apiKey
  apiSecret?: string;
  accessToken?: string;
  baseUrl?: string;
}

// ============================================
// OAuth2 Types
// ============================================

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

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  results: T[];
  count?: number;
}

// ============================================
// Organization Types
// ============================================

export interface Organization {
  eid: string;
  name: string;
  created_date?: string;
  updated_date?: string;
}

// ============================================
// Advertisable Types
// ============================================

export interface Advertisable {
  eid: string;
  name: string;
  status: string;
  created_date?: string;
  updated_date?: string;
  url?: string;
  product_name?: string;
}

export interface AdvertisableCreateParams {
  name: string;
  url?: string;
  product_name?: string;
}

// ============================================
// Campaign Types
// ============================================

export interface Campaign {
  eid: string;
  name: string;
  status: string;
  budget?: number;
  created_date?: string;
  updated_date?: string;
  start_date?: string;
  end_date?: string;
  kpi_goal?: string;
  kpi_metric?: string;
}

export interface CampaignCreateParams {
  name: string;
  budget?: number;
  start_date?: string;
  end_date?: string;
  kpi_goal?: string;
  kpi_metric?: string;
}

export interface CampaignEditParams {
  name?: string;
  budget?: number;
  status?: string;
  start_date?: string;
  end_date?: string;
}

// ============================================
// Adgroup Types
// ============================================

export interface Adgroup {
  eid: string;
  name: string;
  status: string;
  created_date?: string;
  updated_date?: string;
}

export interface AdgroupCreateParams {
  name: string;
  campaign: string;
}

// ============================================
// Ad Types
// ============================================

export interface Ad {
  eid: string;
  name: string;
  status: string;
  type: string;
  width?: number;
  height?: number;
  created_date?: string;
  updated_date?: string;
}

export interface AdCreateParams {
  name: string;
  type: string;
  width?: number;
  height?: number;
  file_source?: string;
}

// ============================================
// Segment Types
// ============================================

export interface Segment {
  eid: string;
  name: string;
  type: string;
  duration?: number;
  created_date?: string;
  updated_date?: string;
}

// ============================================
// List Params
// ============================================

export interface ListParams {
  limit?: number;
  offset?: number;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  resource?: string;
}

export class ConnectorApiError extends Error {
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
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
    this.documentationUrl = options?.documentationUrl;
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
        return 'Authentication failed. Please check your API token.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded (100 req/day per service). Please wait and try again.';
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
      documentationUrl: this.documentationUrl,
      requestId: this.requestId,
    };
  }
}

export function parseApiError(
  response: unknown,
  statusCode: number
): ConnectorApiError {
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
    (data.error_description as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || e.error || 'unknown'),
      message: String(e.message || e.description || 'Unknown error'),
      field: e.field as string,
      resource: e.resource as string,
    }));
  }

  const documentationUrl =
    (data.documentation_url as string) ||
    (data.docs_url as string) ||
    (data.help_url as string);

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new ConnectorApiError(message, statusCode, {
    errors,
    documentationUrl,
    requestId,
  });
}
