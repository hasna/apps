export interface UsebidflowConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface Bid {
  id: string;
  [key: string]: unknown;
}

export interface BidListResponse {
  bids?: Bid[];
  data?: Bid[];
  [key: string]: unknown;
}

export interface CreateBidParams {
  [key: string]: unknown;
}

export interface Event {
  id: string;
  [key: string]: unknown;
}

export interface EventListResponse {
  events?: Event[];
  data?: Event[];
  [key: string]: unknown;
}

export interface SearchParams {
  query?: string;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: unknown[];
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: string;
  path: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

export class UsebidflowApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'UsebidflowApiError';
    this.statusCode = statusCode;
  }
}
