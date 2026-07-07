// StopAndError Connector Types

export interface StopAndErrorConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface WorkflowError {
  id: string;
  message: string;
  code?: string;
  severity?: string;
  workflowId?: string;
  nodeId?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowEvent {
  id: string;
  type: string;
  errorId?: string;
  workflowId?: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

export interface ListErrorsResponse {
  data: WorkflowError[];
  nextCursor?: string;
  hasMore?: boolean;
}

export interface ListEventsResponse {
  data: WorkflowEvent[];
  nextCursor?: string;
  hasMore?: boolean;
}

export interface CreateErrorParams {
  message: string;
  code?: string;
  severity?: string;
  workflowId?: string;
  nodeId?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchParams {
  query: string;
  filters?: Record<string, unknown>;
  limit?: number;
  cursor?: string;
}

export interface SearchResponse {
  data: WorkflowError[];
  nextCursor?: string;
  hasMore?: boolean;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
}

export class StopAndErrorApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'StopAndErrorApiError';
    this.statusCode = statusCode;
  }
}
