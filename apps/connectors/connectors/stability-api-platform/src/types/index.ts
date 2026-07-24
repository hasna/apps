export interface ConnectorConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty' | 'table';

export interface ListQueryParams {
  [key: string]: string | number | boolean | undefined;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: ListQueryParams;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;

  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
