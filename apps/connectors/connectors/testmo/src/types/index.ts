export interface TestmoConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface TestmoPagination {
  page?: number;
  per_page?: number;
  next_page?: number | null;
  last_page?: number;
  prev_page?: number | null;
}

export interface TestmoRun {
  id: number;
  project_id?: number;
  name: string;
  description?: string | null;
  is_closed?: boolean;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  [key: string]: unknown;
}

export interface TestmoEvent {
  id: number;
  type?: string;
  created_at?: string;
  user_id?: number;
  [key: string]: unknown;
}

export interface TestmoSearchRequest {
  query?: string;
  entity?: string;
  project_id?: number;
  [key: string]: unknown;
}

export interface TestmoListRunsParams {
  page?: number;
  per_page?: number;
  project_id?: number;
  is_closed?: boolean | 0 | 1;
  milestone_id?: string;
  expands?: string;
  sort?: string;
}

export interface TestmoListEventsParams {
  page?: number;
  per_page?: number;
  project_id?: number;
  run_id?: number;
  expands?: string;
}

export interface TestmoPaginatedResult<T> {
  result?: T[];
  page?: number;
  per_page?: number;
  next_page?: number | null;
  last_page?: number;
  prev_page?: number | null;
  expands?: Record<string, unknown>;
}

export class TestmoApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TestmoApiError';
    this.statusCode = statusCode;
  }
}
