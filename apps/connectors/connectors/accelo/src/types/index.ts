// Accelo API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;      // For API key authentication (access token)
  token?: string;       // Alias for apiKey
  apiSecret?: string;   // Client secret for OAuth2
  accessToken?: string; // For OAuth2 authentication
  baseUrl?: string;     // Override default base URL (https://{deployment}.api.accelo.com/api/v0)
  deployment?: string;  // Accelo deployment name (subdomain)
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

export interface AcceloMeta {
  status: string;
  message: string;
  more_info?: string;
}

export interface AcceloResponse<T> {
  meta: AcceloMeta;
  response: T;
}

export interface AcceloListResponse<T> {
  meta: AcceloMeta;
  response: T[];
}

export interface ListParams {
  _page?: number;
  _limit?: number;
  _offset?: number;
  _fields?: string;
  _filters?: string;
  _search?: string;
}

// ============================================
// Company Types
// ============================================

export interface Company {
  id: string;
  name: string;
  website?: string;
  phone?: string;
  fax?: string;
  comments?: string;
  status?: string;
  standing?: string;
  date_created?: string;
  date_modified?: string;
  default_affiliation?: string;
}

export interface CreateCompanyParams {
  name: string;
  website?: string;
  phone?: string;
  comments?: string;
}

export interface UpdateCompanyParams {
  name?: string;
  website?: string;
  phone?: string;
  comments?: string;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: string;
  firstname: string;
  surname: string;
  email?: string;
  title?: string;
  phone?: string;
  mobile?: string;
  status?: string;
  standing?: string;
  date_created?: string;
  date_modified?: string;
  company_id?: string;
}

export interface CreateContactParams {
  firstname: string;
  surname: string;
  email?: string;
  title?: string;
  phone?: string;
  mobile?: string;
  company_id?: string;
}

export interface UpdateContactParams {
  firstname?: string;
  surname?: string;
  email?: string;
  title?: string;
  phone?: string;
  mobile?: string;
}

// ============================================
// Task Types
// ============================================

export interface Task {
  id: string;
  title: string;
  description?: string;
  against_type?: string;
  against_id?: string;
  date_created?: string;
  date_started?: string;
  date_due?: string;
  date_completed?: string;
  status?: string;
  assignee?: string;
  budgeted?: number;
  remaining_budget?: number;
}

export interface CreateTaskParams {
  title: string;
  against_type: string;
  against_id: string;
  description?: string;
  date_started?: string;
  date_due?: string;
  assignee?: string;
}

export interface UpdateTaskParams {
  title?: string;
  description?: string;
  date_started?: string;
  date_due?: string;
  assignee?: string;
}

// ============================================
// Issue (Ticket) Types
// ============================================

export interface Issue {
  id: string;
  title: string;
  description?: string;
  against_type?: string;
  against_id?: string;
  type?: string;
  affiliation?: string;
  date_created?: string;
  date_modified?: string;
  date_closed?: string;
  status?: string;
  standing?: string;
  resolution?: string;
  assignee?: string;
}

export interface CreateIssueParams {
  title: string;
  type_id: string;
  affiliation_id: string;
  description?: string;
  against_type?: string;
  against_id?: string;
}

export interface UpdateIssueParams {
  title?: string;
  description?: string;
  resolution?: string;
}

// ============================================
// Job (Project) Types
// ============================================

export interface Job {
  id: string;
  title: string;
  against_type?: string;
  against_id?: string;
  type?: string;
  date_created?: string;
  date_modified?: string;
  date_commenced?: string;
  date_due?: string;
  date_completed?: string;
  status?: string;
  standing?: string;
  manager?: string;
}

export interface CreateJobParams {
  title: string;
  type_id: string;
  against_type: string;
  against_id: string;
  date_commenced?: string;
  date_due?: string;
  manager_id?: string;
}

export interface UpdateJobParams {
  title?: string;
  date_commenced?: string;
  date_due?: string;
}

// ============================================
// Prospect (Sale) Types
// ============================================

export interface Prospect {
  id: string;
  title: string;
  against_type?: string;
  against_id?: string;
  value?: number;
  success?: string;
  date_created?: string;
  date_modified?: string;
  date_due?: string;
  date_won?: string;
  date_lost?: string;
  status?: string;
  standing?: string;
  manager?: string;
  affiliation_id?: string;
}

export interface CreateProspectParams {
  title: string;
  type_id: string;
  affiliation_id: string;
  value?: number;
  date_due?: string;
  manager_id?: string;
}

export interface UpdateProspectParams {
  title?: string;
  value?: number;
  date_due?: string;
  success?: string;
}

// ============================================
// Staff Types
// ============================================

export interface Staff {
  id: string;
  firstname: string;
  surname: string;
  email?: string;
  title?: string;
  phone?: string;
  mobile?: string;
  position?: string;
  username?: string;
  status?: string;
}

// ============================================
// Activity Types
// ============================================

export interface Activity {
  id: string;
  subject: string;
  body?: string;
  against_type?: string;
  against_id?: string;
  owner_type?: string;
  owner_id?: string;
  medium?: string;
  visibility?: string;
  date_created?: string;
  date_modified?: string;
  date_started?: string;
  date_ended?: string;
  thread_id?: string;
}

export interface CreateActivityParams {
  subject: string;
  against_type: string;
  against_id: string;
  body?: string;
  medium?: string;
  visibility?: string;
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
        return 'Authentication failed. Please check your access token or login again.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      case 500:
        return 'Server error. Please try again later.';
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

  // Accelo wraps errors in meta.message
  const meta = data.meta as Record<string, unknown> | undefined;
  const message =
    (meta?.message as string) ||
    (data.message as string) ||
    (data.error as string) ||
    (data.error_description as string) ||
    `HTTP ${statusCode} Error`;

  const documentationUrl = meta?.more_info as string | undefined;

  return new ConnectorApiError(message, statusCode, {
    documentationUrl,
  });
}
