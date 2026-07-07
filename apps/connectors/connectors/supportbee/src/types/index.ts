// SupportBee API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;
  token?: string; // Alias for apiKey (SupportBee auth token)
  accessToken?: string;
  baseUrl?: string; // Required: company-specific URL, e.g. https://mycompany.supportbee.com
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface ListParams {
  page?: number;
  per_page?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface Content {
  text?: string;
  html?: string;
}

// ============================================
// Ticket Types
// ============================================

export interface Ticket {
  id: number;
  subject: string;
  summary?: string;
  unread?: boolean;
  starred?: boolean;
  spam?: boolean;
  trash?: boolean;
  archived?: boolean;
  replies_count?: number;
  comments_count?: number;
  created_at?: string;
  last_activity_at?: string;
  requester?: TicketRequester;
  current_user_assignee?: unknown;
  assignee?: unknown;
  labels?: Label[];
  content?: Content;
  summary_email?: unknown;
}

export interface TicketRequester {
  id?: number;
  name?: string;
  email?: string;
}

export interface TicketCreateParams {
  subject: string;
  requester_name?: string;
  requester_email?: string;
  content?: Content;
}

export interface TicketListParams extends ListParams {
  archived?: boolean;
  spam?: boolean;
  trash?: boolean;
  assigned_user?: string | number;
  assigned_team?: string | number;
  label?: string;
  starred?: boolean;
  since?: string;
  until?: string;
  sort_by?: string;
}

// ============================================
// Reply Types
// ============================================

export interface Reply {
  id: number;
  content?: Content;
  created_at?: string;
  replied_by?: unknown;
}

export interface ReplyCreateParams {
  content: Content;
  cc?: string[];
  bcc?: string[];
}

// ============================================
// Comment Types
// ============================================

export interface Comment {
  id: number;
  content?: Content;
  created_at?: string;
  commented_by?: unknown;
}

export interface CommentCreateParams {
  content: Content;
}

// ============================================
// Label Types
// ============================================

export interface Label {
  id: number;
  name: string;
  color?: string;
}

// ============================================
// User / Agent Types
// ============================================

export interface User {
  id: number;
  name?: string;
  email?: string;
  role?: string;
  avatar_url?: string;
}

// ============================================
// Snippet Types
// ============================================

export interface Snippet {
  id: number;
  name?: string;
  subject?: string;
  text?: string;
  html?: string;
  created_at?: string;
}

export interface SnippetCreateParams {
  name?: string;
  subject?: string;
  text?: string;
  html?: string;
}

export interface SnippetUpdateParams {
  name?: string;
  subject?: string;
  text?: string;
  html?: string;
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
        return 'Authentication failed. Please check your auth token.';
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
