export interface TurbotPipesConfig {
  apiToken: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface TurbotPipesUser {
  id?: string;
  handle?: string;
  display_name?: string;
  [key: string]: unknown;
}

export interface TurbotPipesWorkspace {
  id?: string;
  handle?: string;
  display_name?: string;
  [key: string]: unknown;
}

export interface TurbotPipesListResponse<T = unknown> {
  items?: T[];
  next_token?: string;
  [key: string]: unknown;
}

export interface TurbotPipesQueryRequest {
  sql: string;
  params?: Record<string, unknown> | unknown[];
}

export interface TurbotPipesQueryResponse {
  rows?: unknown[];
  columns?: unknown[];
  [key: string]: unknown;
}

export class TurbotPipesApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'TurbotPipesApiError';
    this.status = status;
    this.details = details;
  }
}
