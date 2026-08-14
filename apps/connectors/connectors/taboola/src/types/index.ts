// Taboola Backstage API Types
// Reference: https://developers.taboola.com/backstage-api/reference

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  accountId?: string;
  baseUrl?: string;
}

// ============================================
// OAuth2 Types (client_credentials flow)
// ============================================

export interface OAuth2Credentials {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  expiresAt: number;
  tokenType?: string;
}

/** Raw token response from POST /backstage/oauth/token */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

/** Taboola list responses wrap the collection under `results`. */
export interface CollectionResponse<T> {
  results: T[];
  metadata?: {
    total?: number;
    count?: number;
    [key: string]: unknown;
  };
}

// ============================================
// Account Types
// ============================================

export interface Account {
  id: string;
  account_id: string;
  name: string;
  type?: string;
  partner_types?: string[];
  campaign_types?: string[];
  currency?: string;
  time_zone_name?: string;
  is_active?: boolean;
}

// ============================================
// Campaign Types
// ============================================

export type SpendingLimitModel = 'MONTHLY' | 'ENTIRE' | 'NONE';
export type CampaignStatus =
  | 'RUNNING'
  | 'PAUSED'
  | 'PENDING_APPROVAL'
  | 'REJECTED'
  | 'TERMINATED'
  | string;

export interface Campaign {
  id: string;
  name: string;
  advertiser_id?: string;
  branding_text?: string;
  cpc?: number;
  daily_cap?: number | null;
  spending_limit?: number | null;
  spending_limit_model?: SpendingLimitModel;
  is_active?: boolean;
  status?: CampaignStatus;
  start_date?: string | null;
  end_date?: string | null;
  marketing_objective?: string;
  bid_type?: string;
  bid_strategy?: string;
}

export interface CampaignCreateParams {
  name: string;
  branding_text: string;
  cpc: number;
  spending_limit: number;
  spending_limit_model?: SpendingLimitModel;
  marketing_objective?: string;
  daily_cap?: number;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
}

export interface CampaignUpdateParams {
  name?: string;
  branding_text?: string;
  cpc?: number;
  spending_limit?: number;
  spending_limit_model?: SpendingLimitModel;
  daily_cap?: number;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
}

// ============================================
// Campaign Item (creative) Types
// ============================================

export interface CampaignItem {
  id: string;
  campaign_id?: string;
  type?: string;
  url?: string;
  thumbnail_url?: string;
  title?: string;
  description?: string;
  is_active?: boolean;
  status?: string;
  approval_state?: string;
  cta?: { cta_type?: string };
}

export interface CampaignItemCreateParams {
  url: string;
  title?: string;
  thumbnail_url?: string;
  description?: string;
  is_active?: boolean;
}

export interface CampaignItemUpdateParams {
  title?: string;
  thumbnail_url?: string;
  description?: string;
  is_active?: boolean;
}

// ============================================
// Report Types
// ============================================

export interface ReportParams {
  start_date: string;
  end_date: string;
  filters?: Record<string, string | number | boolean | undefined>;
}

export interface ReportResponse {
  timezone?: string;
  last_used_rawdata_update_time?: string;
  results: Record<string, unknown>[];
  metadata?: {
    total?: number;
    count?: number;
    dimensions?: unknown[];
    [key: string]: unknown;
  };
  'recordCount'?: number;
}

export type CampaignSummaryDimension =
  | 'day'
  | 'week'
  | 'month'
  | 'content_provider_breakdown'
  | 'campaign_breakdown'
  | 'site_breakdown'
  | 'country_breakdown'
  | 'platform_breakdown'
  | 'campaign_day_breakdown'
  | string;

// ============================================
// Audience Types
// ============================================

export interface FirstPartyAudienceCreateParams {
  audience_name: string;
  ttl_in_hours?: number;
  integration_source?: string;
  exclude_from_campaigns?: boolean;
}

export interface Audience {
  audience_id?: string;
  audience_name?: string;
  ttl_in_hours?: number;
  status?: string;
  audience_type?: string;
}

export interface AudienceTargeting {
  collection?: unknown[];
  href?: string;
  [key: string]: unknown;
}

// ============================================
// API Error Types
// ============================================

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
        return 'Authentication failed. Please check your client credentials or access token.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
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

  // Taboola surfaces errors as { message, error, code } or nested under `errors`.
  const message =
    (data.message as string) ||
    (data.error_description as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
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
