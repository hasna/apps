// Weights & Biases API Platform Connector Types

export interface WeightsBiasesApiPlatformConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ItemSummary {
  id: string;
  name?: string;
  type?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ItemsListResponse {
  items?: ItemSummary[];
  data?: ItemSummary[];
  nextPage?: string;
  [key: string]: unknown;
}

export interface CreateItemParams {
  name?: string;
  type?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EventRecord {
  id?: string;
  itemId?: string;
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EventsListResponse {
  events?: EventRecord[];
  data?: EventRecord[];
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  filters?: Record<string, unknown>;
  order?: string;
  perPage?: number;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: unknown[];
  data?: unknown[];
  [key: string]: unknown;
}

export interface ApiErrorDetail {
  code?: string;
  message: string;
  field?: string;
}

export class WeightsBiasesApiPlatformError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'WeightsBiasesApiPlatformError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
