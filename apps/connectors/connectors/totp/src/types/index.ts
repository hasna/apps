export interface TotpConfig {
  apiKey: string;
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

export interface TotpCode {
  id: string;
  name?: string;
  issuer?: string;
  account?: string;
  algorithm?: string;
  digits?: number;
  period?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface TotpEvent {
  id: string;
  type?: string;
  code_id?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface TotpListResponse<T> {
  data?: T[];
  items?: T[];
  codes?: T[];
  events?: T[];
  [key: string]: unknown;
}

export interface TotpSearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

export interface TotpRawRequestOptions {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export type OutputFormat = 'json' | 'pretty';

export class TotpApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TotpApiError';
    this.statusCode = statusCode;
  }
}
