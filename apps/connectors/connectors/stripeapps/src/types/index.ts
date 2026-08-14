// Stripe Apps API Types
// REST client for the Stripe Apps API (items, events, search).

// ============================================
// Configuration
// ============================================

export interface StripeAppsConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// ISO 8601 date string
export type DateString = string;

// ============================================
// Common Types
// ============================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ListParams {
  limit?: number;
  cursor?: string;
}

export interface ListResponse<T> {
  object?: string;
  data: T[];
  hasMore?: boolean;
  nextCursor?: string;
}

// ============================================
// Item Types
// ============================================

export interface Item {
  id: string;
  object?: string;
  name?: string;
  description?: string;
  status?: string;
  createdAt?: DateString;
  updatedAt?: DateString;
  metadata?: Record<string, unknown>;
  // The Stripe Apps items surface is generic; keep it forward-compatible.
  [key: string]: unknown;
}

export interface ItemListParams extends ListParams {
  status?: string;
}

export type ItemListResponse = ListResponse<Item>;

export interface ItemCreateInput {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// ============================================
// Event Types
// ============================================

export interface Event {
  id: string;
  object?: string;
  type?: string;
  createdAt?: DateString;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EventListParams extends ListParams {
  type?: string;
}

export type EventListResponse = ListResponse<Event>;

// ============================================
// Search Types
// ============================================

export interface SearchOptions {
  query: string;
  limit?: number;
  cursor?: string;
  filters?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  object?: string;
  score?: number;
  [key: string]: unknown;
}

export interface SearchResponse {
  object?: string;
  data: SearchResult[];
  hasMore?: boolean;
  nextCursor?: string;
}

// ============================================
// Raw Request Types
// ============================================

export interface RawRequestOptions {
  method?: HttpMethod;
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code?: string;
  message: string;
  param?: string;
}

export class StripeAppsApiError extends Error {
  public readonly statusCode: number;
  public readonly detail?: ApiErrorDetail;

  constructor(message: string, statusCode: number, detail?: ApiErrorDetail) {
    super(message);
    this.name = 'StripeAppsApiError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}
