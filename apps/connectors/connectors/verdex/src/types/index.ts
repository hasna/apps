// Verdex Connector Types

export interface VerdexConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type QueryParams = Record<string, string | number | boolean | undefined>;

export interface VerdexListResponse<T = Record<string, unknown>> {
  data?: T[];
  items?: T[];
  [key: string]: unknown;
}

export interface VerdexClaim {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export interface VerdexVerification {
  id: string;
  status?: string;
  claim_id?: string;
  [key: string]: unknown;
}

export interface VerdexPortfolio {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface VerdexSiteConditions {
  site_id: string;
  conditions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface VerdexMonitoringJob {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: QueryParams;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export class VerdexApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;

  constructor(message: string, statusCode: number, responseBody?: string) {
    super(message);
    this.name = 'VerdexApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}

export function parseApiError(response: unknown, statusCode: number): VerdexApiError {
  if (typeof response === 'string') {
    return new VerdexApiError(response, statusCode, response);
  }

  if (!response || typeof response !== 'object') {
    return new VerdexApiError(`HTTP ${statusCode} Error`, statusCode);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    ((data.error as Record<string, unknown>)?.message as string) ||
    `HTTP ${statusCode} Error`;

  return new VerdexApiError(message, statusCode, JSON.stringify(data));
}
