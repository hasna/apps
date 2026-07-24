// WithAI API Types

export interface WithAiConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

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

export type OutputFormat = 'json' | 'pretty';

export interface ListParams {
  [key: string]: string | number | boolean | undefined;
}

export interface Workspace {
  id: string;
  name?: string;
  firm?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface WorkspaceListResponse {
  workspaces?: Workspace[];
  data?: Workspace[];
  [key: string]: unknown;
}

export interface ResearchTask {
  id: string;
  workspace_id?: string;
  ticker?: string;
  prompt?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ResearchTaskCreateInput {
  ticker?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface DocumentSearchInput {
  search_text?: string;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DocumentSearchResult {
  documents?: Array<Record<string, unknown>>;
  results?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface PortfolioAlertInput {
  ticker?: string;
  threshold?: string;
  [key: string]: unknown;
}

export interface PortfolioAlert {
  id?: string;
  ticker?: string;
  threshold?: string;
  [key: string]: unknown;
}

export interface Integration {
  id?: string;
  name?: string;
  status?: string;
  type?: string;
  [key: string]: unknown;
}

export interface IntegrationListResponse {
  integrations?: Integration[];
  data?: Integration[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  path?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: Record<string, unknown> | unknown[];
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  resource?: string;
}

export class WithAiApiError extends Error {
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
    this.name = 'WithAiApiError';
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
): WithAiApiError {
  if (typeof response === 'string') {
    return new WithAiApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new WithAiApiError(`HTTP ${statusCode} Error`, statusCode);
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

  return new WithAiApiError(message, statusCode, {
    errors,
    documentationUrl,
    requestId,
  });
}

// Back-compat alias used by client scaffold
export { WithAiApiError as ConnectorApiError };
