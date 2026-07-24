// Zolvo Connector Types

export interface ZolvoConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ListLoansOptions {
  status?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ListPaymentsOptions {
  unmatched?: boolean | string;
  [key: string]: string | number | boolean | undefined;
}

export interface ReconcilePaymentRequest {
  confidence?: number;
  [key: string]: unknown;
}

export interface CreateServicingTaskRequest {
  task?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | unknown>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class ZolvoApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: unknown;

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message);
    this.name = 'ZolvoApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}
