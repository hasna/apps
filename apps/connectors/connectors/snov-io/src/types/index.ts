export interface SnovIoConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface Campaign {
  id: number;
  campaign: string;
  list_id: number;
  status: string;
  created_at: number;
  updated_at: number;
  started_at?: number;
  hash: string;
}

export interface DomainSearchStartResponse {
  success: boolean;
  task_hash?: string;
  result?: string;
  status?: string;
  message?: string;
}

export interface DomainSearchResultResponse {
  success: boolean;
  status?: string;
  data?: Record<string, unknown>;
  message?: string;
}

export interface BalanceResponse {
  success: boolean;
  data?: {
    balance: string;
    teamwork: boolean;
    unique_recipients_used: number;
    limit_resets_in: number;
    expires_in: number;
  };
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export class SnovIoApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'SnovIoApiError';
    this.statusCode = statusCode;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseApiError(response: unknown, statusCode: number): SnovIoApiError {
  if (typeof response === 'string') {
    return new SnovIoApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new SnovIoApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    (data.error_description as string) ||
    `HTTP ${statusCode} Error`;

  return new SnovIoApiError(message, statusCode);
}
