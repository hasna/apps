// Agile CRM API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  apiSecret?: string;
  accessToken?: string;
  baseUrl?: string;
  domain?: string;
  email?: string;
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
// Contact / Company Types
// ============================================

export interface ContactProperty {
  name: string;
  value: string;
  type: 'SYSTEM' | 'CUSTOM';
  subtype?: string;
}

export interface Contact {
  id: number;
  type: 'PERSON' | 'COMPANY';
  created_time: number;
  updated_time: number;
  star_value: number;
  lead_score: number;
  tags: string[];
  properties: ContactProperty[];
  campaign_status?: string[];
  entity_type?: string;
  source?: string;
  contact_company_id?: number;
  owner?: ContactOwner;
}

export interface ContactOwner {
  id: number;
  email: string;
  name?: string;
}

export interface ContactCreateParams {
  type?: 'PERSON' | 'COMPANY';
  star_value?: number;
  lead_score?: number;
  tags?: string[];
  properties: ContactProperty[];
}

export interface ContactUpdateParams {
  id: number;
  properties: ContactProperty[];
}

export interface ContactListParams {
  page_size?: number;
  cursor?: string;
}

// ============================================
// Deal Types
// ============================================

export interface Deal {
  id: number;
  name: string;
  description?: string;
  expected_value: number;
  probability: number;
  milestone: string;
  close_date?: number;
  created_time: number;
  updated_time?: number;
  contact_ids: number[];
  custom_data?: DealCustomField[];
  pipeline_id?: number;
  owner_id?: number;
  won_date?: number;
  lost_reason_id?: number;
}

export interface DealCustomField {
  name: string;
  value: string;
}

export interface DealCreateParams {
  name: string;
  description?: string;
  expected_value?: number;
  probability?: number;
  milestone: string;
  close_date?: number;
  contact_ids?: number[];
  custom_data?: DealCustomField[];
  pipeline_id?: number;
}

export interface DealUpdateParams {
  id: number;
  name?: string;
  description?: string;
  expected_value?: number;
  probability?: number;
  milestone?: string;
  close_date?: number;
  contact_ids?: number[];
  custom_data?: DealCustomField[];
  pipeline_id?: number;
}

export interface DealListParams {
  page_size?: number;
  cursor?: string;
}

// ============================================
// Task Types
// ============================================

export interface Task {
  id: number;
  type: string;
  priority_type: string;
  subject: string;
  description?: string;
  due: number;
  is_complete: boolean;
  created_time: number;
  contact_ids?: number[];
  deal_ids?: number[];
  taskOwner?: ContactOwner;
  progress?: number;
  status?: string;
}

export interface TaskCreateParams {
  type: string;
  priority_type: string;
  subject: string;
  description?: string;
  due: number;
  contact_ids?: number[];
  deal_ids?: number[];
  progress?: number;
  status?: string;
}

export interface TaskUpdateParams {
  id: number;
  type?: string;
  priority_type?: string;
  subject?: string;
  description?: string;
  due?: number;
  is_complete?: boolean;
  progress?: number;
  status?: string;
}

// ============================================
// Note Types
// ============================================

export interface Note {
  id: number;
  subject: string;
  description: string;
  contact_ids?: number[];
  deal_ids?: number[];
  created_time: number;
}

export interface NoteCreateParams {
  subject: string;
  description: string;
  contact_ids?: number[];
  deal_ids?: number[];
}

// ============================================
// Pipeline Types
// ============================================

export interface Pipeline {
  id: number;
  name: string;
  milestones: string;
  deal_sources?: string;
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
        return 'Authentication failed. Please check your email and API key.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Plan limits: Free 100/day, Starter 1K/day, Regular 5K/day, Enterprise 20K/day.';
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
