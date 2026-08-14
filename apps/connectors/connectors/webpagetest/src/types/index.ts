export interface WebPageTestConfig {
  apiKey: string;
  baseUrl?: string;
  classicBaseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

export interface WebPageTestErrorBody {
  message?: string;
  statusText?: string;
  statusCode?: number;
  errors?: string[];
}

export class WebPageTestApiError extends Error {
  readonly status: number;
  readonly body?: WebPageTestErrorBody;

  constructor(message: string, status: number, body?: WebPageTestErrorBody) {
    super(message);
    this.name = 'WebPageTestApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ListTestsParams {
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface CreateTestBody {
  url: string;
  location?: string;
  runs?: number;
  label?: string;
  [key: string]: unknown;
}

export interface SearchBody {
  query?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export interface RunTestParams {
  url: string;
  location?: string;
  runs?: number;
  f?: 'json' | 'xml';
  label?: string;
  [key: string]: string | number | boolean | undefined;
}
