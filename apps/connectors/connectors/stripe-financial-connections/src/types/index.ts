// Stripe Financial Connections Connector Types

export interface StripeFinancialConnectionsConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export class StripeFinancialConnectionsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'StripeFinancialConnectionsApiError';
  }
}

export interface FinancialConnectionItem {
  id: string;
  object: string;
  institution_name?: string;
  status?: string;
  created?: number;
  [key: string]: unknown;
}

export interface ListItemsResponse {
  object: string;
  data: FinancialConnectionItem[];
  has_more: boolean;
  url: string;
}

export interface FinancialConnectionEvent {
  id: string;
  object: string;
  type?: string;
  created?: number;
  [key: string]: unknown;
}

export interface ListEventsResponse {
  object: string;
  data: FinancialConnectionEvent[];
  has_more: boolean;
  url: string;
}

export interface SearchResponse {
  object: string;
  data: unknown[];
  has_more?: boolean;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}
