export interface UltimateAiConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface UltimateAiBot {
  id: string;
  name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface UltimateAiEvent {
  id: string;
  type?: string;
  bot_id?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface UltimateAiSearchParams {
  query?: string;
  bot_id?: string;
  limit?: number;
  [key: string]: unknown;
}

export interface UltimateAiSearchResult {
  results?: unknown[];
  [key: string]: unknown;
}

export type OutputFormat = 'json' | 'pretty';

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

export class UltimateAiApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'UltimateAiApiError';
    this.statusCode = statusCode;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }
}
