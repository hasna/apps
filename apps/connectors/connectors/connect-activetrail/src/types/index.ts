// ActiveTrail API Types

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
  Page?: number;
  Limit?: number;
}

// ============================================
// Contact Types
// ============================================

export interface Contact {
  ID: number;
  Email: string;
  FirstName: string;
  LastName: string;
  Phone1: string;
  Phone2: string;
  Fax: string;
  Birthday: string | null;
  City: string;
  Street: string;
  Zipcode: string;
  Anniversary: string | null;
  Company: string;
  Status: number;
  IsDeleted: boolean;
  CreatedDate: string;
  ModifiedDate: string;
}

export interface ContactCreateParams {
  Email: string;
  FirstName?: string;
  LastName?: string;
  Phone1?: string;
  Phone2?: string;
  Fax?: string;
  Birthday?: string;
  City?: string;
  Street?: string;
  Zipcode?: string;
  Anniversary?: string;
  Company?: string;
}

export interface ContactUpdateParams {
  Email?: string;
  FirstName?: string;
  LastName?: string;
  Phone1?: string;
  Phone2?: string;
  Fax?: string;
  Birthday?: string;
  City?: string;
  Street?: string;
  Zipcode?: string;
  Anniversary?: string;
  Company?: string;
}

// ============================================
// Group Types
// ============================================

export interface Group {
  ID: number;
  Name: string;
  Description: string;
  Status: number;
  CreatedDate: string;
  ModifiedDate: string;
  SubscribersCount: number;
}

export interface GroupCreateParams {
  Name: string;
  Description?: string;
}

// ============================================
// Campaign Types
// ============================================

export interface Campaign {
  ID: number;
  Name: string;
  Subject: string;
  FromName: string;
  FromAddress: string;
  ReplyTo: string;
  Status: number;
  CreatedDate: string;
  ModifiedDate: string;
  ScheduledDate: string | null;
  SentDate: string | null;
}

export interface CampaignCreateParams {
  Name: string;
  Subject: string;
  FromName: string;
  FromAddress: string;
  ReplyTo?: string;
}

export interface CampaignUpdateParams {
  Name?: string;
  Subject?: string;
  FromName?: string;
  FromAddress?: string;
  ReplyTo?: string;
}

export interface CampaignSchedule {
  ScheduledDate: string;
  TimeZone?: string;
}

// ============================================
// Campaign Report Types
// ============================================

export interface CampaignReport {
  CampaignId: number;
  Name: string;
  SentDate: string;
  TotalSent: number;
  TotalDelivered: number;
  TotalOpens: number;
  UniqueOpens: number;
  TotalClicks: number;
  UniqueClicks: number;
  TotalBounces: number;
  TotalUnsubscribes: number;
  TotalComplaints: number;
}

export interface CampaignReportContact {
  Email: string;
  FirstName: string;
  LastName: string;
  Date: string;
}

// ============================================
// Automation Types
// ============================================

export interface Automation {
  ID: number;
  Name: string;
  Status: number;
  CreatedDate: string;
  ModifiedDate: string;
  TotalStarted: number;
  TotalEnded: number;
}

// ============================================
// Template Types
// ============================================

export interface Template {
  ID: number;
  Name: string;
  Subject: string;
  HtmlContent: string;
  CreatedDate: string;
  ModifiedDate: string;
}

export interface TemplateCreateParams {
  Name: string;
  Subject: string;
  HtmlContent: string;
}

export interface TemplateUpdateParams {
  Name?: string;
  Subject?: string;
  HtmlContent?: string;
}

// ============================================
// Webhook Types
// ============================================

export interface Webhook {
  ID: number;
  Url: string;
  EventType: string;
  Status: number;
  CreatedDate: string;
}

export interface WebhookCreateParams {
  Url: string;
  EventType: string;
}

export interface WebhookUpdateParams {
  Url?: string;
  EventType?: string;
}

// ============================================
// Account Types
// ============================================

export interface AccountBalance {
  EmailBalance: number;
  SmsBalance: number;
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
    (data.Message as string) ||
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
