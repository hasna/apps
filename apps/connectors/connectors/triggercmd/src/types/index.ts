// TRIGGERcmd Connector Types

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  accessToken?: string;
  baseUrl?: string;
}

// ============================================
// OAuth2 Types (scaffold compatibility)
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
// Computer Types
// ============================================

export interface Computer {
  _id?: string;
  id?: string;
  name?: string;
  friendlyName?: string;
  [key: string]: unknown;
}

export interface ComputerListResponse {
  records?: Computer[];
  [key: string]: unknown;
}

// ============================================
// Command Types
// ============================================

export interface Command {
  _id?: string;
  id?: string;
  name?: string;
  trigger?: string;
  computer?: string;
  computer_id?: string;
  did?: string;
  allowParams?: boolean;
  [key: string]: unknown;
}

export interface CommandListParams {
  computer_id?: string;
}

export interface CommandListResponse {
  records?: Command[];
  [key: string]: unknown;
}

// ============================================
// Trigger Types
// ============================================

export interface TriggerParams {
  computer: string;
  trigger: string;
  params?: string;
}

export interface TriggerResponse {
  success?: boolean;
  message?: string;
  err?: string;
  [key: string]: unknown;
}

// ============================================
// Run History Types
// ============================================

export interface RunRecord {
  _id?: string;
  status?: string;
  createdAt?: string;
  command_id?: string;
  [key: string]: unknown;
}

export interface RunListParams {
  sortOn?: string;
  command_id?: string;
}

export interface RunListResponse {
  records?: RunRecord[];
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
        return 'Authentication failed. Please check your TRIGGERcmd API token.';
      case 403:
        return 'Access denied. Your token may not have the required permissions.';
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
    (data.err as string) ||
    (data.message as string) ||
    (data.error as string) ||
    (data.error_description as string) ||
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
