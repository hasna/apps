// Windmill API Types

export interface WindmillConfig {
  apiKey: string;
  baseUrl?: string;
  workspace?: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface ScriptRecord {
  path?: string;
  summary?: string;
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

export class WindmillApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'WindmillApiError';
  }
}
