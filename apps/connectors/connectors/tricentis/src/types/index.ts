export interface TricentisConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface TricentisTest {
  id: string;
  name?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TricentisEvent {
  id: string;
  type?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface TricentisSearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

export interface TricentisSearchResult {
  results?: unknown[];
  total?: number;
  [key: string]: unknown;
}

export interface TricentisRawRequestOptions {
  method?: string;
  path: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export class TricentisApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TricentisApiError';
    this.statusCode = statusCode;
  }
}

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}
