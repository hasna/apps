export interface TransformConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface Pipeline {
  id: string;
  name?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PipelineListResponse {
  pipelines?: Pipeline[];
  data?: Pipeline[];
  items?: Pipeline[];
  [key: string]: unknown;
}

export interface PipelineCreateParams {
  name?: string;
  description?: string;
  [key: string]: unknown;
}

export interface TransformEvent {
  id: string;
  type?: string;
  pipelineId?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface EventListResponse {
  events?: TransformEvent[];
  data?: TransformEvent[];
  items?: TransformEvent[];
  [key: string]: unknown;
}

export interface SearchParams {
  query?: string;
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: unknown[];
  data?: unknown[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export class TransformApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TransformApiError';
    this.statusCode = statusCode;
  }
}
