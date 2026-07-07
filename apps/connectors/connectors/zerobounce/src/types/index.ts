// ZeroBounce API Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  apiSecret?: string;
  accessToken?: string;
  baseUrl?: string;
  bulkBaseUrl?: string;
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

// ============================================
// Validation Types
// ============================================

export interface ValidateParams {
  email: string;
  ip_address?: string;
  timeout?: number;
  activity_data?: boolean;
  verify_plus?: boolean;
}

export interface ValidateSandboxParams extends ValidateParams {}

export interface BatchEmailEntry {
  email_address: string;
  ip_address?: string | null;
}

export interface ValidateBatchParams {
  email_batch: BatchEmailEntry[];
  timeout?: number;
  activity_data?: boolean;
  verify_plus?: boolean;
}

export interface ValidationResult {
  address?: string;
  status?: string;
  sub_status?: string;
  free_email?: boolean;
  catchall_domain?: boolean | null;
  did_you_mean?: string | null;
  account?: string | null;
  domain?: string | null;
  domain_age_days?: string | null;
  active_in_days?: string | null;
  active_first_seen?: string | null;
  smtp_provider?: string | null;
  mx_found?: string | boolean;
  mx_record?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  gender?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  zipcode?: string | null;
  processed_at?: string;
}

export interface BatchValidationError {
  error: string;
  email_address: string;
}

export interface ValidateBatchResult {
  email_batch: ValidationResult[];
  errors: BatchValidationError[];
}

// ============================================
// Account Types
// ============================================

export interface CreditsResult {
  Credits: number;
}

export interface ApiUsageParams {
  start_date: string;
  end_date: string;
}

export interface ApiUsageResult {
  total?: number;
  [key: string]: unknown;
}

// ============================================
// Bulk File Types
// ============================================

export interface SendFileParams {
  file: Blob | Uint8Array;
  fileName: string;
  email_address_column: number;
  first_name_column?: number;
  last_name_column?: number;
  gender_column?: number;
  ip_address_column?: number;
  has_header_row?: boolean;
  remove_duplicate?: boolean;
  allow_phase_2?: boolean;
  return_url?: string;
}

export interface SendFileResult {
  success: boolean;
  message?: string;
  file_name?: string;
  file_id?: string;
  error_message?: string;
}

export interface FileStatusParams {
  file_id: string;
}

export interface FileStatusResult {
  success: boolean;
  file_id?: string;
  file_name?: string;
  upload_date?: string;
  file_status?: string;
  file_phase_2_status?: string;
  complete_percentage?: string;
  return_url?: string;
  error_message?: string;
}

export interface GetFileParams {
  file_id: string;
}

export interface DeleteFileParams {
  file_id: string;
}

export interface BulkFileActionResult {
  success: boolean;
  message?: string;
  error_message?: string;
  [key: string]: unknown;
}

// ============================================
// Scoring Types
// ============================================

export interface SendScoringFileParams extends SendFileParams {}

export interface ScoringFileStatusParams {
  file_id: string;
}

export interface AiScoringScoreParams {
  email: string;
  ip_address?: string;
}

export interface AiScoringScoreResult {
  email?: string;
  score?: number;
  [key: string]: unknown;
}

// ============================================
// Enrichment Types
// ============================================

export interface GuessFormatParams {
  email: string;
}

export interface GuessFormatResult {
  email?: string;
  format?: string;
  [key: string]: unknown;
}

export interface DomainSearchParams {
  domain: string;
  format?: string;
  page?: number;
  limit?: number;
}

export interface DomainSearchResult {
  domain?: string;
  emails?: string[];
  [key: string]: unknown;
}

export interface ActivityParams {
  email: string;
}

export interface ActivityResult {
  email?: string;
  active?: boolean;
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

export class ZeroBounceApiError extends Error {
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
    this.name = 'ZeroBounceApiError';
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
      case 403:
        return 'Authentication failed. Please check your ZeroBounce API key.';
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
): ZeroBounceApiError {
  if (typeof response === 'string') {
    return new ZeroBounceApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ZeroBounceApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;

  const message =
    (data.error as string) ||
    (data.error_message as string) ||
    (data.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  return new ZeroBounceApiError(message, statusCode);
}
