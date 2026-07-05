// Trigger.dev Connector Types

export interface TriggerDevConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export class TriggerDevApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TriggerDevApiError';
    this.status = status;
  }
}

export interface Run {
  id: string;
  taskIdentifier?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  payload?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

export interface RunListResponse {
  data?: Run[];
  runs?: Run[];
  [key: string]: unknown;
}

export interface Event {
  id?: string;
  type?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface EventListResponse {
  data?: Event[];
  events?: Event[];
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  [key: string]: unknown;
}

export interface SearchResponse {
  data?: unknown[];
  results?: unknown[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}
