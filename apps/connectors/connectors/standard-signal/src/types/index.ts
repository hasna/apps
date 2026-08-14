// Standard Signal API Types

export const DEFAULT_BASE_URL = 'https://api.standardsignal.com/v1';

export interface StandardSignalConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ListQueryParams {
  [key: string]: string | number | boolean | undefined;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: ListQueryParams;
  body?: unknown;
  headers?: Record<string, string>;
}

export class StandardSignalApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'StandardSignalApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}
