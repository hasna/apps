// Travo AI API types

export interface TravoAiConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface Trip {
  id: string;
  [key: string]: unknown;
}

export interface TripsListResponse {
  trips?: Trip[];
  data?: Trip[];
  [key: string]: unknown;
}

export interface CreateTripRequest {
  [key: string]: unknown;
}

export interface Event {
  id: string;
  [key: string]: unknown;
}

export interface EventsListResponse {
  events?: Event[];
  data?: Event[];
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: unknown[];
  data?: unknown[];
  [key: string]: unknown;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RawRequestOptions {
  path: string;
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export class TravoAiApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'TravoAiApiError';
  }
}
