// Vitally Connector Types

export type VitallyRegion = 'us' | 'eu';

export interface VitallyConfig {
  apiKey: string;
  subdomain?: string;
  region?: VitallyRegion;
  baseUrl?: string;
  /** Pre-encoded Basic auth header copied from Vitally UI (optional) */
  authHeader?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface VitallyListResponse<T> {
  results: T[];
  next?: string | null;
}

export interface VitallyAccount {
  id: string;
  externalId?: string;
  name?: string;
  traits?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface CreateAccountInput {
  externalId: string;
  name?: string;
  traits?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VitallyEvent {
  id: string;
  name?: string;
  userId?: string;
  accountId?: string;
  timestamp?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VitallySearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  limit?: number;
  from?: string;
  [key: string]: unknown;
}

export interface VitallySearchResponse<T = unknown> {
  results: T[];
  next?: string | null;
  total?: number;
}

export interface VitallyApiErrorBody {
  message?: string;
  error?: string;
  statusCode?: number;
}

export class VitallyApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: VitallyApiErrorBody;

  constructor(message: string, statusCode: number, body?: VitallyApiErrorBody) {
    super(message);
    this.name = 'VitallyApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}
