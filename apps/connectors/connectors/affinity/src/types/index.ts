// Affinity CRM API Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;      // Affinity API Key
  token?: string;       // Alias for apiKey
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

export interface PaginatedResponse<T> {
  data: T[];
  next_page_token?: string | null;
}

export interface ListParams {
  page_size?: number;
  page_token?: string;
}

// ============================================
// Person Types
// ============================================

export interface Person {
  id: number;
  type: number;
  first_name: string;
  last_name: string;
  primary_email?: string;
  emails?: string[];
  organization_ids?: number[];
  opportunity_ids?: number[];
  list_entries?: ListEntry[];
  fields?: FieldValue[];
}

export interface PersonCreateParams {
  first_name: string;
  last_name: string;
  emails?: string[];
  organization_ids?: number[];
}

// ============================================
// Organization (Company) Types
// ============================================

export interface Organization {
  id: number;
  name: string;
  domain?: string;
  domains?: string[];
  person_ids?: number[];
  opportunity_ids?: number[];
  list_entries?: ListEntry[];
  fields?: FieldValue[];
}

export interface OrganizationCreateParams {
  name: string;
  domain?: string;
  person_ids?: number[];
}

// ============================================
// Opportunity Types
// ============================================

export interface Opportunity {
  id: number;
  name: string;
  list_id: number;
  person_ids?: number[];
  organization_ids?: number[];
  list_entries?: ListEntry[];
  fields?: FieldValue[];
}

export interface OpportunityCreateParams {
  name: string;
  list_id: number;
  person_ids?: number[];
  organization_ids?: number[];
}

// ============================================
// List Types
// ============================================

export interface AffinityList {
  id: number;
  type: number;
  name: string;
  public: boolean;
  owner_id: number;
  list_size: number;
  creator_id?: number;
  fields?: Field[];
}

// ============================================
// List Entry Types
// ============================================

export interface ListEntry {
  id: number;
  list_id: number;
  entity_id: number;
  entity_type: number;
  created_at?: string;
  creator_id?: number;
  fields?: FieldValue[];
}

export interface ListEntryCreateParams {
  entity_id: number;
  entity_type?: number;
  creator_id?: number;
}

// ============================================
// Field Types
// ============================================

export interface Field {
  id: number;
  name: string;
  list_id?: number;
  value_type: number;
  allows_multiple: boolean;
  track_changes: boolean;
  enrichment_source?: string;
}

export interface FieldValue {
  id: number;
  field_id: number;
  entity_id: number;
  list_entry_id?: number;
  value: unknown;
  value_type: number;
  created_at?: string;
  updated_at?: string;
}

export interface FieldValueCreateParams {
  field_id: number;
  entity_id: number;
  value: unknown;
  list_entry_id?: number;
}

// ============================================
// Note Types
// ============================================

export interface Note {
  id: number;
  creator_id: number;
  parent_id?: number;
  content: string;
  created_at: string;
  person_ids?: number[];
  organization_ids?: number[];
  opportunity_ids?: number[];
}

export interface NoteCreateParams {
  content: string;
  person_ids?: number[];
  organization_ids?: number[];
  opportunity_ids?: number[];
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
      case 422:
        return 'Invalid parameters. Please check your input.';
      case 429:
        return 'Rate limit exceeded (900 req/min). Please wait and try again.';
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
