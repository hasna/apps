// Travo Connector Types

export interface ConnectorConfig {
  apiKey?: string;
  token?: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: QueryParams;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface PropertySearchParams extends QueryParams {
  assetType?: string;
  state?: string;
  q?: string;
}

export interface CompsParams extends QueryParams {
  radius?: number;
}

export interface EnrichPropertyBody {
  sources?: string[];
  [key: string]: unknown;
}

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, options?: { requestId?: string }) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.requestId = options?.requestId;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string') {
    return new ConnectorApiError(response, statusCode);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const errorObj = data.error as Record<string, unknown> | undefined;
  const message =
    (errorObj?.message as string) ||
    (data.message as string) ||
    (data.error as string) ||
    `HTTP ${statusCode} Error`;

  const requestId =
    (data.request_id as string) ||
    (data.requestId as string) ||
    (data.trace_id as string);

  return new ConnectorApiError(message, statusCode, { requestId });
}
