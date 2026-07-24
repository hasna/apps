// Write Binary File API types

export interface WriteBinaryFileConfig {
  apiKey: string;
  baseUrl?: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue>;

export interface ListQueryOptions {
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface RawRequestOptions {
  path: string;
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: JsonRecord;
  headers?: Record<string, string>;
}

export class WriteBinaryFileApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'WriteBinaryFileApiError';
  }
}
