// Vapi Connector Types

export interface VapiConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface ListParams {
  limit?: number;
  createdAtGt?: string;
  createdAtLt?: string;
  updatedAtGt?: string;
  updatedAtLt?: string;
}

export interface Assistant {
  id: string;
  orgId?: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Call {
  id: string;
  orgId?: string;
  assistantId?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PhoneNumber {
  id: string;
  orgId?: string;
  number?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface Tool {
  id: string;
  orgId?: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown> | unknown[];
  params?: Record<string, string | number | boolean | undefined>;
}

export class VapiApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'VapiApiError';
    this.statusCode = statusCode;
  }
}
