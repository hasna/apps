// SseTrigger Connector Types

export interface SseTriggerConfig {
  apiKey: string;
  baseUrl?: string;
}

export type JsonRecord = Record<string, unknown>;

export interface Stream extends JsonRecord {
  id?: string;
  name?: string;
}

export interface Event extends JsonRecord {
  id?: string;
  stream_id?: string;
  type?: string;
}

export interface SearchRequest extends JsonRecord {
  query?: string;
  filters?: JsonRecord;
}

export interface SearchResponse extends JsonRecord {
  results?: JsonRecord[];
}

export interface RawRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined>;
  body?: JsonRecord | unknown[];
  headers?: Record<string, string>;
}

export class SseTriggerApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'SseTriggerApiError';
    this.statusCode = statusCode;
  }
}

export function parseApiError(data: unknown, status: number): SseTriggerApiError {
  const message = typeof data === 'object' && data !== null
    ? JSON.stringify(data)
    : String(data || `HTTP ${status}`);
  return new SseTriggerApiError(message, status);
}
