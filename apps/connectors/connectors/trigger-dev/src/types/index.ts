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

export interface RunListParams {
  limit?: number | string;
  status?: string | string[];
  taskIdentifier?: string | string[];
  version?: string | number;
  after?: string;
  before?: string;
  from?: string;
  to?: string;
  period?: string;
}

export interface TriggerRunRequest {
  taskIdentifier: string;
  payload?: unknown;
  context?: unknown;
  options?: Record<string, unknown>;
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

export interface QueryRequest {
  query: string;
  scope?: 'environment' | 'project' | 'organization';
  period?: string | null;
  from?: string | null;
  to?: string | null;
  format?: 'json' | 'csv';
  [key: string]: unknown;
}

export interface QueryResponse {
  format?: 'json' | 'csv';
  data?: unknown[];
  results?: unknown[];
  [key: string]: unknown;
}

export type SearchRequest = QueryRequest;
export type SearchResponse = QueryResponse;

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: Record<string, string | number | boolean | readonly (string | number | boolean)[] | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}
