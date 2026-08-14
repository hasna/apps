// Voltair Connector Types

export interface VoltairConfig {
  apiKey: string;
  baseUrl?: string;
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type VoltairProject = Record<string, unknown>;
export type VoltairRun = Record<string, unknown>;

export interface VoltairProjectsListResponse {
  projects?: VoltairProject[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: QueryParams;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class VoltairApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'VoltairApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
