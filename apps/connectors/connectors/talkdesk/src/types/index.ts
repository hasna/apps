// Talkdesk connector types
// Rebuilt from the public Talkdesk API documentation: https://docs.talkdesk.com

// ============================================
// Configuration
// ============================================

export interface TalkdeskConfig {
  /** OAuth client ID (client credentials grant) */
  clientId?: string;
  /** OAuth client secret (client credentials grant) */
  clientSecret?: string;
  /** Pre-obtained bearer access token (skips the token exchange) */
  accessToken?: string;
  /** API base URL. Defaults to https://api.talkdeskapp.com */
  baseUrl?: string;
  /** OAuth token endpoint for the Talkdesk identity domain, e.g. https://<account>.talkdeskid.com/oauth/token */
  authUrl?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export type OutputFormat = 'json' | 'table' | 'pretty';

// ============================================
// Users API (https://docs.talkdesk.com/docs/usersapi)
// ============================================

export interface TalkdeskUser {
  id: string;
  name?: string;
  email?: string;
  created_at?: string;
  login_type?: string;
  availability_status?: string;
  [key: string]: unknown;
}

export interface TalkdeskUserList {
  _embedded?: { users: TalkdeskUser[] };
  total?: number;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

// ============================================
// Contacts API (https://docs.talkdesk.com/docs/contacts-api)
// ============================================

export interface TalkdeskContact {
  id: string;
  name?: string;
  emails?: Array<{ email: string; type?: string }>;
  phones?: Array<{ number: string; type?: string }>;
  company?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface TalkdeskContactList {
  _embedded?: { contacts: TalkdeskContact[] };
  total?: number;
  page?: number;
  per_page?: number;
  [key: string]: unknown;
}

export interface TalkdeskContactCreateParams {
  name: string;
  emails?: Array<{ email: string; type?: string }>;
  phones?: Array<{ number: string; type?: string }>;
  company?: string;
  [key: string]: unknown;
}

// ============================================
// Explore Reporting API (https://docs.talkdesk.com/docs/explore-api)
// ============================================

export type ReportFormat = 'csv' | 'json' | 'json_bulk';

export interface TalkdeskReportJobParams {
  /** ISO 8601 start timestamp (e.g. 2026-01-01T00:00:00.000Z) */
  timespan_start?: string;
  /** ISO 8601 end timestamp */
  timespan_end?: string;
  /** Output file format for the generated report */
  format?: ReportFormat;
  [key: string]: unknown;
}

export interface TalkdeskReportJob {
  job_id: string;
  status: string;
  format?: string;
  _links?: Record<string, { href: string }>;
  [key: string]: unknown;
}

// ============================================
// API Error
// ============================================

export class TalkdeskApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: unknown;

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message);
    this.name = 'TalkdeskApiError';
    this.statusCode = statusCode;
    this.body = body;
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
        return 'Authentication failed. Check your OAuth client credentials.';
      case 403:
        return 'Access denied. Your OAuth client is missing the required scope.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      case 500:
        return 'Talkdesk server error. Please try again later.';
      case 502:
      case 503:
      case 504:
        return 'Talkdesk service temporarily unavailable. Please try again later.';
      default:
        return this.message;
    }
  }
}
