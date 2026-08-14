// Acquire.io API Types
// Customer support platform - live chat, video, co-browsing, chatbot, email, VoIP, SMS

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;      // Bearer token for API auth
  token?: string;       // Alias for apiKey
  accessToken?: string; // For OAuth2 authentication
  baseUrl?: string;     // Override default base URL (https://{account_id}.acquire.io/api/v1)
  accountId?: string;   // Acquire account ID (subdomain)
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
  page?: number;
  where?: string;
  relations?: string;
  select?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  page?: number;
  offset?: number;
  limit?: number;
  count?: number;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  id: number;
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  avatar?: string;
  tags?: Tag[];
  fields?: Record<string, unknown>;
  dateCreated?: string;
  dateUpdated?: string;
  [key: string]: unknown;
}

export interface ContactCreateParams {
  name?: string;
  email?: string;
  phone?: string;
  fields?: Record<string, unknown>;
}

export interface ContactUpdateParams {
  name?: string;
  email?: string;
  phone?: string;
  fields?: Record<string, unknown>;
}

export interface ContactSearchParams {
  payload?: Record<string, unknown>;
  page?: number;
  limit?: number;
  search?: string;
}

export interface ContactBlockParams {
  data: number[];
  type?: string;
  blockTill?: number;
}

// ============================================
// Case / Conversation Types
// ============================================

export interface Case {
  id: number;
  status?: string;
  contactId?: number;
  userId?: number;
  dateQueue?: string;
  dateActive?: string;
  dateClosed?: string;
  contact?: Contact;
  messages?: Message[];
  tags?: Tag[];
  [key: string]: unknown;
}

export interface CaseCreateParams {
  contactId: number;
}

export interface CaseReopenParams {
  contactId: number;
  sessionId: string;
  threadId: string;
}

// ============================================
// Message Types
// ============================================

export interface Message {
  id: number;
  type?: string;
  content?: string;
  sender?: string;
  dateCreated?: string;
  [key: string]: unknown;
}

export interface ChatMessageParams {
  threadId?: string;
  sessionId?: string;
  message: string;
  type?: string;
}

export interface EmailMessageParams {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  cc?: string;
  bcc?: string;
  attachments?: unknown[];
}

export interface SmsMessageParams {
  From: string;
  To: string;
  Body: string;
  contactId?: number;
  threadId?: string;
}

// ============================================
// Company Types
// ============================================

export interface Company {
  id: number;
  name?: string;
  website?: string;
  industry?: string;
  fields?: Record<string, unknown>;
  contacts?: Contact[];
  dateCreated?: string;
  dateUpdated?: string;
  [key: string]: unknown;
}

export interface CompanyCreateParams {
  fields: {
    name: string;
    website?: string;
    industry?: string;
    [key: string]: unknown;
  };
}

export interface CompanyUpdateParams {
  fields?: Record<string, unknown>;
}

// ============================================
// Note Types
// ============================================

export interface Note {
  id: number;
  contactId?: number;
  type?: string;
  title?: string;
  description?: string;
  userId?: number;
  dateCreated?: string;
  [key: string]: unknown;
}

export interface NoteCreateParams {
  contactId: number;
  title: string;
  description?: string;
  type?: string;
}

export interface NoteUpdateParams {
  title?: string;
  description?: string;
}

// ============================================
// Knowledge Base Types
// ============================================

export interface KbGroup {
  id: number;
  name: string;
  customDomain?: string;
  language?: string;
  [key: string]: unknown;
}

export interface KbGroupCreateParams {
  name: string;
  customDomain?: string;
  language?: string;
}

export interface KbArticle {
  id: number;
  groupId?: number;
  title?: string;
  description?: string;
  tags?: string[];
  status?: string;
  seoTitle?: string;
  seoDescription?: string;
  author?: string;
  [key: string]: unknown;
}

export interface KbArticleUpdateParams {
  title?: string;
  description?: string;
  tags?: string[];
  status?: string;
  seoTitle?: string;
  seoDescription?: string;
  jsonContent?: unknown;
  departmentIds?: number[];
  articleCategories?: number[];
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  id: number;
  name: string;
  [key: string]: unknown;
}

// ============================================
// Analytics Types
// ============================================

export interface AnalyticsParams {
  start_date: string;
  end_date: string;
  offset?: string;
  output?: 'json' | 'csv';
}

export interface CallsOverview {
  incoming?: number;
  outgoing?: number;
  missed?: number;
  avgDuration?: number;
  [key: string]: unknown;
}

export interface SmsMetrics {
  incoming?: number;
  outgoing?: number;
  failed?: number;
  [key: string]: unknown;
}

// ============================================
// Bot Types
// ============================================

export interface BotQnA {
  id: number;
  question?: string;
  answer?: string;
  groupId?: number;
  type?: string;
  [key: string]: unknown;
}

// ============================================
// Card Types (Beta)
// ============================================

export interface Card {
  id: number;
  contactId?: number;
  type?: string;
  data?: unknown;
  dateCreated?: string;
  [key: string]: unknown;
}

export interface CardCreateParams {
  contact_id: number;
  type?: string;
  data?: unknown;
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
        return 'Authentication failed. Please check your API key.';
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
