// Topaz Labs Image API Types

export interface TopazLabsConfig {
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

export interface TopazJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  [key: string]: unknown;
}

export interface TopazJobList {
  jobs?: TopazJob[];
  cursor?: string;
  [key: string]: unknown;
}

export interface TopazModel {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface TopazPreset {
  id: string;
  name: string;
  feature: string;
  settings?: Record<string, unknown>;
  description?: string;
  [key: string]: unknown;
}

export interface TopazTag {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface TopazUploadUrl {
  upload_url: string;
  [key: string]: unknown;
}

export interface TopazCredits {
  balance?: number;
  [key: string]: unknown;
}

export interface TopazUsage {
  [key: string]: unknown;
}

export interface TopazAccount {
  [key: string]: unknown;
}

export interface TopazWebhook {
  id: string;
  url: string;
  events: string[];
  active?: boolean;
  [key: string]: unknown;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class TopazLabsApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, options?: { errors?: ApiErrorDetail[] }) {
    super(message);
    this.name = 'TopazLabsApiError';
    this.statusCode = statusCode;
    this.errors = options?.errors;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

export function parseApiError(response: unknown, statusCode: number): TopazLabsApiError {
  if (typeof response === 'string') {
    return new TopazLabsApiError(response, statusCode);
  }
  if (!response || typeof response !== 'object') {
    return new TopazLabsApiError(`HTTP ${statusCode} Error`, statusCode);
  }
  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    (data.detail as string) ||
    `HTTP ${statusCode} Error`;
  return new TopazLabsApiError(message, statusCode);
}
