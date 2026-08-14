export interface WizConfig {
  apiKey: string;
  baseUrl?: string;
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

export interface WizIssue {
  id: string;
  title?: string;
  severity?: string;
  status?: string;
  resource?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface WizEvent {
  id: string;
  type?: string;
  timestamp?: string;
  source?: string;
  [key: string]: unknown;
}

export interface WizIssuesResponse {
  issues?: WizIssue[];
  data?: WizIssue[];
  [key: string]: unknown;
}

export interface WizEventsResponse {
  events?: WizEvent[];
  data?: WizEvent[];
  [key: string]: unknown;
}

export interface WizSearchRequest {
  query: string;
  [key: string]: unknown;
}

export interface WizSearchResponse {
  results?: unknown[];
  data?: unknown[];
  [key: string]: unknown;
}

export interface WizRawRequestOptions {
  method?: string;
  path: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
}

export class WizApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'WizApiError';
    this.statusCode = statusCode;
  }
}
