// Valence API Types

export interface ValenceConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ProfileConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface ListParams {
  [key: string]: string | number | boolean | undefined;
}

export interface CreateOrderRequest {
  marketId?: string;
  side?: string;
  size?: number;
  price?: number;
  type?: string;
  [key: string]: unknown;
}

export interface MatchTickersRequest {
  tickers?: string[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  params?: ListParams;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class ValenceApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'ValenceApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
