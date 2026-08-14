// Wayco Connector Types

export interface WaycoConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface WaycoCase {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export interface WaycoLead {
  id: string;
  [key: string]: unknown;
}

export interface WaycoVoiceCall {
  id: string;
  [key: string]: unknown;
}

export interface WaycoErrorBody {
  message?: string;
  error?: string;
  errors?: Array<{ message?: string; code?: string }>;
}

export class WaycoApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: WaycoErrorBody;

  constructor(message: string, statusCode: number, body?: WaycoErrorBody) {
    super(message);
    this.name = 'WaycoApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

export type RawRequestOptions = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
};
