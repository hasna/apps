// AccuRanker API Types

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

export interface ListParams {
  limit?: number;
  offset?: number;
  fields?: string;
}

// ============================================
// Account Types
// ============================================

export interface Account {
  id: number;
  name: string;
  [key: string]: unknown;
}

// ============================================
// Domain Types
// ============================================

export interface Domain {
  id: number;
  domain: string;
  display_name?: string;
  include_subdomains?: boolean;
  exact_match?: boolean;
  share_of_voice_percentage?: boolean;
  [key: string]: unknown;
}

export interface DomainCreateParams {
  domain: string;
  group_id: number;
  display_name?: string;
  include_subdomains?: boolean;
  exact_match?: boolean;
  share_of_voice_percentage?: boolean;
  default_searchsettings_names?: SearchSettings[];
}

export interface DomainUpdateParams {
  display_name?: string;
  include_subdomains?: boolean;
  exact_match?: boolean;
  share_of_voice_percentage?: boolean;
}

export interface SearchSettings {
  countrylocale: string;
  search_engine_names: string[];
  search_type_names: string[];
  locations?: string[];
  ignore_local_results?: boolean;
  ignore_featured_snippet?: boolean;
  enable_autocorrect?: boolean;
  primary?: boolean;
}

// ============================================
// Keyword Types
// ============================================

export interface Keyword {
  id: number;
  keyword: string;
  search_type?: string;
  starred?: boolean;
  description?: string;
  tags?: string[];
  ranks?: KeywordRank;
  [key: string]: unknown;
}

export interface KeywordRank {
  rank?: number;
  rank_change?: number;
  search_volume?: number;
  cpc?: number;
  url?: string;
  share_of_voice?: number;
  ctr?: number;
  serp_features?: string[];
  search_intent?: string;
  [key: string]: unknown;
}

export interface KeywordCreateParams {
  domain_id: number;
  keywords: string[];
  tags?: string[];
  starred?: boolean;
  ignore_local_results?: boolean;
  ignore_featured_snippet?: boolean;
  ignore_in_share_of_voice?: boolean;
  enable_autocorrect?: boolean;
  description?: string;
}

export interface KeywordUpdateParams {
  keyword_ids: number[];
  starred?: boolean;
  tags?: string[];
  description?: string;
}

export interface KeywordDeleteParams {
  keyword_ids: number[];
}

// ============================================
// Landing Page Types
// ============================================

export interface LandingPage {
  id: number;
  path: string;
  [key: string]: unknown;
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  id: number;
  tag: string;
  [key: string]: unknown;
}

// ============================================
// Group Types
// ============================================

export interface Group {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface GroupCreateParams {
  account_id: number;
  name: string;
}

// ============================================
// Brand Types
// ============================================

export interface Brand {
  id: number;
  [key: string]: unknown;
}

export interface BrandPrompt {
  id: number;
  [key: string]: unknown;
}

// ============================================
// Job Types
// ============================================

export interface KeywordJob {
  status: string;
  [key: string]: unknown;
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
