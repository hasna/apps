// SMTP2GO Connector Types
// Rebuilt from the public SMTP2GO v3 API docs (https://developers.smtp2go.com/).

// ============================================
// Configuration
// ============================================

export interface Smtp2goConfig {
  /** SMTP2GO API key (sent as the X-Smtp2go-Api-Key header). */
  apiKey: string;
  /** Override the default base URL (https://api.smtp2go.com/v3). */
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

// ============================================
// Envelope
// ============================================

/**
 * Every SMTP2GO v3 response is wrapped in an envelope that carries a
 * request_id plus a `data` payload specific to the endpoint.
 */
export interface Smtp2goResponse<T> {
  request_id: string;
  data: T;
}

// ============================================
// Email Send
// ============================================

export interface CustomHeader {
  header: string;
  value: string;
}

export interface Attachment {
  /** File name shown to the recipient. */
  filename: string;
  /** Base64-encoded file contents. */
  fileblob: string;
  /** MIME type, e.g. "application/pdf". */
  mimetype?: string;
}

/** Inline attachments are referenced from HTML by their filename (cid). */
export type Inline = Attachment;

export interface SendEmailParams {
  /** Sender, e.g. "Name <sender@example.com>" or "sender@example.com". */
  sender: string;
  /** Recipient addresses. */
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text_body?: string;
  html_body?: string;
  custom_headers?: CustomHeader[];
  attachments?: Attachment[];
  inlines?: Inline[];
  /** Template id when sending with a stored template. */
  template_id?: string;
  /** Substitution data for the template. */
  template_data?: Record<string, unknown>;
}

export interface SendMimeParams {
  /** Envelope sender address. */
  sender: string;
  /** Envelope recipient addresses. */
  to: string[];
  /** Raw, pre-encoded MIME message. */
  mime_email: string;
}

export interface SendEmailFailure {
  recipient?: string;
  error_code?: string;
  error?: string;
}

export interface SendEmailResult {
  succeeded: number;
  failed: number;
  failures: SendEmailFailure[];
  email_id: string;
}

// ============================================
// Email Search (activity stream for a message)
// ============================================

export interface EmailSearchParams {
  /** ISO timestamp; only events at/after this time are returned. */
  start_date?: string;
  /** ISO timestamp; only events at/before this time are returned. */
  end_date?: string;
  sender?: string;
  recipient?: string;
  subject?: string;
  limit?: number;
  offset?: number;
}

export interface EmailSearchResult {
  total_hits: number;
  emails: Record<string, unknown>[];
}

// ============================================
// Activity Search
// ============================================

export interface ActivitySearchParams {
  start_date?: string;
  end_date?: string;
  /** Filter by event type, e.g. "opened", "clicked", "unsubscribed". */
  events?: string[];
  email_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ActivitySearchResult {
  total_hits: number;
  events: Record<string, unknown>[];
}

// ============================================
// Statistics
// ============================================

export interface StatsDateRange {
  start_date?: string;
  end_date?: string;
}

export type StatsSummary = Record<string, unknown>;
export type StatsBounces = Record<string, unknown>;
export type StatsCycle = Record<string, unknown>;
export type StatsHistory = Record<string, unknown>;
export type StatsSpam = Record<string, unknown>;
export type StatsUnsubscribes = Record<string, unknown>;

// ============================================
// Suppressions
// ============================================

export interface Suppression {
  email: string;
  reason?: string;
  suppressed_at?: string;
}

export interface SuppressionListResult {
  suppressions: Suppression[];
}

export interface SuppressionMutationResult {
  suppressions: string[];
}

// ============================================
// Sender Domains
// ============================================

export interface Domain {
  domain: string;
  verified?: boolean;
  dkim_verified?: boolean;
  return_path_verified?: boolean;
  tracking_verified?: boolean;
  [key: string]: unknown;
}

export interface DomainListResult {
  domains: Domain[];
}

export interface DomainResult {
  domain: Domain;
}

// ============================================
// Single Senders
// ============================================

export interface SingleSender {
  email: string;
  verified?: boolean;
  [key: string]: unknown;
}

export interface SingleSenderListResult {
  single_senders: SingleSender[];
}

// ============================================
// SMTP Users
// ============================================

export interface SmtpUser {
  username: string;
  email?: string;
  full_name?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface SmtpUserListResult {
  users: SmtpUser[];
}

export interface SmtpUserCreateParams {
  username: string;
  email_password: string;
  full_name?: string;
}

export interface SmtpUserUpdateParams {
  username: string;
  new_username?: string;
  email_password?: string;
  full_name?: string;
  enabled?: boolean;
}

// ============================================
// API Errors
// ============================================

export interface Smtp2goErrorData {
  error?: string;
  error_code?: string;
  field_validation_errors?: Record<string, unknown> | unknown[];
}

export class Smtp2goApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: string;
  public readonly requestId?: string;
  public readonly fieldErrors?: Record<string, unknown> | unknown[];

  constructor(
    message: string,
    statusCode: number,
    options?: {
      errorCode?: string;
      requestId?: string;
      fieldErrors?: Record<string, unknown> | unknown[];
    }
  ) {
    super(message);
    this.name = 'Smtp2goApiError';
    this.statusCode = statusCode;
    this.errorCode = options?.errorCode;
    this.requestId = options?.requestId;
    this.fieldErrors = options?.fieldErrors;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403 || this.errorCode === 'E_ApiResponseCodes.NON_VALIDATING_IN_PAYLOAD';
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errorCode: this.errorCode,
      requestId: this.requestId,
      fieldErrors: this.fieldErrors,
    };
  }
}

/**
 * Parse an SMTP2GO error envelope into a Smtp2goApiError.
 * SMTP2GO returns errors inside the same `data` envelope, e.g.:
 *   { request_id, data: { error, error_code, field_validation_errors } }
 */
export function parseApiError(response: unknown, statusCode: number): Smtp2goApiError {
  if (typeof response === 'string') {
    return new Smtp2goApiError(response || `HTTP ${statusCode} error`, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new Smtp2goApiError(`HTTP ${statusCode} error`, statusCode);
  }

  const envelope = response as { request_id?: string; data?: Smtp2goErrorData };
  const data = envelope.data ?? (response as Smtp2goErrorData);

  const message = data?.error || `HTTP ${statusCode} error`;

  return new Smtp2goApiError(message, statusCode, {
    errorCode: data?.error_code,
    requestId: envelope.request_id,
    fieldErrors: data?.field_validation_errors,
  });
}
