// Xai API Platform connector types

export interface XaiApiPlatformConfig {
  apiKey: string;
  baseUrl?: string;
}

export type JsonObject = Record<string, unknown>;
export type JsonValue = unknown;

export type OutputFormat = 'json' | 'pretty';

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined>;
  body?: JsonObject | unknown[] | string;
  headers?: Record<string, string>;
}

export class XaiApiPlatformApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'XaiApiPlatformApiError';
    this.statusCode = statusCode;
  }
}
