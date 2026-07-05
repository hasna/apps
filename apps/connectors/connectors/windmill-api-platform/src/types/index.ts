// Windmill Api Platform API Types

export interface WindmillApiPlatformConfig {
  apiKey: string;
  baseUrl?: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ItemRecord {
  id?: string;
  [key: string]: JsonValue | undefined;
}

export interface EventRecord {
  id?: string;
  [key: string]: JsonValue | undefined;
}

export interface SearchRequest {
  query?: string;
  [key: string]: JsonValue | undefined;
}

export interface RawRequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export class WindmillApiPlatformApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'WindmillApiPlatformApiError';
  }
}
