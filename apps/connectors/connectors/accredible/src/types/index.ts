// Accredible API Types

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
  page?: number;
  page_size?: number;
}

// ============================================
// Credential Types
// ============================================

export interface Recipient {
  id?: number;
  name: string;
  email: string;
  url?: string;
}

export interface Credential {
  id: number;
  name: string;
  description?: string;
  recipient: Recipient;
  group_id?: number;
  group_name?: string;
  issued_on?: string;
  expired_on?: string;
  custom_attributes?: Record<string, string>;
  url?: string;
  badge?: boolean;
  certificate?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CredentialCreateParams {
  credential: {
    recipient: {
      name: string;
      email: string;
    };
    group_id?: number;
    name?: string;
    description?: string;
    issued_on?: string;
    expired_on?: string;
    custom_attributes?: Record<string, string>;
  };
  evidence_items?: EvidenceItemCreate[];
}

export interface CredentialUpdateParams {
  credential: {
    name?: string;
    description?: string;
    issued_on?: string;
    expired_on?: string;
    custom_attributes?: Record<string, string>;
    group_id?: number;
  };
}

export interface CredentialResponse {
  credential: Credential;
}

export interface CredentialListResponse {
  credentials: Credential[];
  meta?: {
    current_page?: number;
    total_pages?: number;
    total_count?: number;
  };
}

// ============================================
// Group Types
// ============================================

export interface Group {
  id: number;
  name: string;
  course_name?: string;
  course_description?: string;
  course_link?: string;
  language?: string;
  attach_pdf?: boolean;
  design_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface GroupCreateParams {
  group: {
    name: string;
    course_name?: string;
    course_description?: string;
    course_link?: string;
    language?: string;
    attach_pdf?: boolean;
    design_id?: number;
  };
}

export interface GroupUpdateParams {
  group: {
    name?: string;
    course_name?: string;
    course_description?: string;
    course_link?: string;
    language?: string;
    attach_pdf?: boolean;
    design_id?: number;
  };
}

export interface GroupResponse {
  group: Group;
}

export interface GroupListResponse {
  groups: Group[];
  meta?: {
    current_page?: number;
    total_pages?: number;
    total_count?: number;
  };
}

// ============================================
// Design Types
// ============================================

export interface Design {
  id: number;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface DesignListResponse {
  designs: Design[];
  meta?: {
    current_page?: number;
    total_pages?: number;
    total_count?: number;
  };
}

// ============================================
// Evidence Item Types
// ============================================

export interface EvidenceItem {
  id: number;
  description: string;
  category?: string;
  url?: string;
  string_object?: string;
  hidden?: boolean;
  credential_id?: number;
}

export interface EvidenceItemCreate {
  description: string;
  category?: string;
  url?: string;
  string_object?: string;
  hidden?: boolean;
  file?: string;
}

export interface EvidenceItemResponse {
  evidence_item: EvidenceItem;
}

// ============================================
// SSO Types
// ============================================

export interface SsoLinkParams {
  sso: {
    email: string;
    group_id?: number;
    credential_id?: number;
  };
}

export interface SsoLinkResponse {
  link: string;
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
