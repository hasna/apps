// Crow Platform API Types

export interface ConnectorConfig {
  productId?: string;
  identityToken?: string;
  baseUrl?: string;
  model?: string;
  subdomain?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface SendMessageParams {
  message?: string;
  conversation_id?: string;
  identity_token?: string;
  model?: string;
  subdomain?: string;
  [key: string]: unknown;
}

export interface ListConversationsParams {
  identity_token?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ConversationHistoryParams {
  conversationId: string;
  identity_token?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface AnonymousConversationHistoryParams {
  conversationId: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ListRecordedWorkflowsParams {
  [key: string]: string | number | boolean | undefined;
}

export interface BrowserUseParams {
  session_id?: string;
  action?: string;
  identity_token?: string;
  model?: string;
  subdomain?: string;
  [key: string]: unknown;
}

export interface RawRequestParams {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, options?: { errors?: ApiErrorDetail[] }) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.error as string) ||
    (data.message as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;

  let errors: ApiErrorDetail[] | undefined;
  if (Array.isArray(data.errors)) {
    errors = data.errors.map((e: Record<string, unknown>) => ({
      code: String(e.code || e.error || 'unknown'),
      message: String(e.message || e.description || 'Unknown error'),
      field: e.field as string,
    }));
  }

  return new ConnectorApiError(message, statusCode, { errors });
}
