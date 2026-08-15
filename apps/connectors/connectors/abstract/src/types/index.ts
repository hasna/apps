// Abstract API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
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

// ============================================
// IP Geolocation Types
// ============================================

export interface GeolocationParams {
  ip_address?: string;
  fields?: string;
}

export interface GeolocationResult {
  ip_address: string;
  city?: string;
  city_geoname_id?: number;
  region?: string;
  region_iso_code?: string;
  region_geoname_id?: number;
  postal_code?: string;
  country?: string;
  country_code?: string;
  country_geoname_id?: number;
  country_is_eu?: boolean;
  continent?: string;
  continent_code?: string;
  continent_geoname_id?: number;
  longitude?: number;
  latitude?: number;
  security?: {
    is_vpn?: boolean;
  };
  timezone?: {
    name?: string;
    abbreviation?: string;
    gmt_offset?: number;
    current_time?: string;
    is_dst?: boolean;
  };
  flag?: {
    emoji?: string;
    unicode?: string;
    png?: string;
    svg?: string;
  };
  currency?: {
    currency_name?: string;
    currency_code?: string;
  };
  connection?: {
    autonomous_system_number?: number;
    autonomous_system_organization?: string;
    connection_type?: string;
    isp_name?: string;
    organization_name?: string;
  };
}

// ============================================
// Email Validation Types
// ============================================

export interface EmailValidationParams {
  email: string;
  auto_correct?: boolean;
}

export interface EmailValidationResult {
  email: string;
  autocorrect?: string;
  deliverability?: string;
  quality_score?: string;
  is_valid_format?: {
    value?: boolean;
    text?: string;
  };
  is_free_email?: {
    value?: boolean;
    text?: string;
  };
  is_disposable_email?: {
    value?: boolean;
    text?: string;
  };
  is_role_email?: {
    value?: boolean;
    text?: string;
  };
  is_catchall_email?: {
    value?: boolean;
    text?: string;
  };
  is_mx_found?: {
    value?: boolean;
    text?: string;
  };
  is_smtp_valid?: {
    value?: boolean;
    text?: string;
  };
}

// ============================================
// Phone Validation Types
// ============================================

export interface PhoneValidationParams {
  phone: string;
}

export interface PhoneValidationResult {
  phone?: string;
  valid?: boolean;
  format?: {
    international?: string;
    local?: string;
  };
  country?: {
    code?: string;
    name?: string;
    prefix?: string;
  };
  location?: string;
  type?: string;
  carrier?: string;
}

// ============================================
// Exchange Rates Types
// ============================================

export interface ExchangeRateLiveParams {
  base: string;
  target?: string;
}

export interface ExchangeRateConvertParams {
  base: string;
  target: string;
  base_amount?: number;
  date?: string;
}

export interface ExchangeRateHistoricalParams {
  base: string;
  target?: string;
  date: string;
}

export interface ExchangeRateLiveResult {
  base?: string;
  last_updated?: number;
  exchange_rates?: Record<string, number>;
}

export interface ExchangeRateConvertResult {
  base?: string;
  target?: string;
  base_amount?: number;
  converted_amount?: number;
  exchange_rate?: number;
  last_updated?: number;
}

// ============================================
// Company Enrichment Types
// ============================================

export interface CompanyEnrichmentParams {
  domain: string;
  fields?: string;
}

export interface CompanyEnrichmentResult {
  name?: string;
  domain?: string;
  year_founded?: number;
  industry?: string;
  employees_count?: number;
  locality?: string;
  country?: string;
  linkedin_url?: string;
  facebook_url?: string;
  twitter_url?: string;
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
        return 'Authentication failed. Please check your Abstract API key.';
      case 403:
        return 'Access denied. Your API key may not have access to this service.';
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

  const errorObj = data.error as Record<string, unknown> | undefined;
  const message =
    (errorObj?.message as string) ||
    (data.message as string) ||
    (data.error as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode);
}
