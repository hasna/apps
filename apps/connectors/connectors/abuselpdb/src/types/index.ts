// AbuseIPDB API Types

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
// Check IP Types
// ============================================

export interface CheckParams {
  ipAddress: string;
  maxAgeInDays?: number;
  verbose?: boolean;
}

export interface CheckReport {
  reportedAt: string;
  comment: string;
  categories: number[];
  reporterId: number;
  reporterCountryCode: string;
  reporterCountryName?: string;
}

export interface CheckResult {
  ipAddress: string;
  isPublic: boolean;
  ipVersion: number;
  isWhitelisted?: boolean;
  abuseConfidenceScore: number;
  countryCode?: string;
  countryName?: string;
  usageType?: string;
  isp?: string;
  domain?: string;
  hostnames?: string[];
  isTor?: boolean;
  totalReports: number;
  numDistinctUsers: number;
  lastReportedAt?: string;
  reports?: CheckReport[];
}

// ============================================
// Check Block Types
// ============================================

export interface CheckBlockParams {
  network: string;
  maxAgeInDays?: number;
}

export interface ReportedAddress {
  ipAddress: string;
  numReports: number;
  mostRecentReport: string;
  abuseConfidenceScore: number;
  countryCode?: string;
}

export interface CheckBlockResult {
  networkAddress: string;
  netmask: string;
  minAddress: string;
  maxAddress: string;
  numPossibleHosts: number;
  addressSpaceDesc: string;
  reportedAddress: ReportedAddress[];
}

// ============================================
// Report Types
// ============================================

export interface ReportParams {
  ip: string;
  categories: string;
  comment?: string;
  timestamp?: string;
}

export interface ReportResult {
  ipAddress: string;
  abuseConfidenceScore: number;
}

// ============================================
// Reports (List) Types
// ============================================

export interface ReportsParams {
  ipAddress: string;
  maxAgeInDays?: number;
  page?: number;
  perPage?: number;
}

export interface ReportsResult {
  total: number;
  page: number;
  count: number;
  perPage: number;
  lastPage: number;
  nextPageUrl?: string;
  previousPageUrl?: string;
  results: CheckReport[];
}

// ============================================
// Blacklist Types
// ============================================

export interface BlacklistParams {
  confidenceMinimum?: number;
  limit?: number;
  onlyCountries?: string;
  exceptCountries?: string;
  ipVersion?: number;
}

export interface BlacklistEntry {
  ipAddress: string;
  abuseConfidenceScore: number;
  lastReportedAt?: string;
  countryCode?: string;
}

export interface BlacklistResult {
  meta: {
    generatedAt: string;
  };
  data: BlacklistEntry[];
}

// ============================================
// Clear Address Types
// ============================================

export interface ClearAddressParams {
  ipAddress: string;
}

export interface ClearAddressResult {
  numReportsDeleted: number;
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
        return 'Authentication failed. Please check your AbuseIPDB API key.';
      case 403:
        return 'Access denied. Your API key may not have permission for this endpoint.';
      case 404:
        return 'Resource not found.';
      case 422:
        return 'Validation error. Please check your parameters.';
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

  // AbuseIPDB uses { errors: [{ detail: "...", source: { parameter: "..." } }] }
  const errors = data.errors as Array<Record<string, unknown>> | undefined;
  let message = `HTTP ${statusCode} Error`;
  let apiErrors: ApiErrorDetail[] | undefined;

  if (Array.isArray(errors) && errors.length > 0) {
    message = errors.map(e => String(e.detail || e.message || 'Unknown error')).join('; ');
    apiErrors = errors.map(e => ({
      code: String(e.status || statusCode),
      message: String(e.detail || e.message || 'Unknown error'),
      field: (e.source as Record<string, unknown>)?.parameter as string,
    }));
  } else if (data.message) {
    message = String(data.message);
  }

  return new ConnectorApiError(message, statusCode, { errors: apiErrors });
}
