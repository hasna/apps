// ZeroSettle Connector Types

export interface ZeroSettleConfig {
  publishableKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface ZeroSettleErrorBody {
  error?: string;
  message?: string;
  detail?: string;
  [key: string]: unknown;
}

export class ZeroSettleApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: ZeroSettleErrorBody;

  constructor(message: string, statusCode: number, body?: ZeroSettleErrorBody) {
    super(message);
    this.name = 'ZeroSettleApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

export interface Product {
  id: string;
  name?: string;
  type?: string;
  price?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface PaymentIntent {
  id: string;
  status?: string;
  client_secret?: string;
  [key: string]: unknown;
}

export interface CheckoutSession {
  id: string;
  url?: string;
  status?: string;
  [key: string]: unknown;
}

export interface Transaction {
  id: string;
  status?: string;
  product_id?: string;
  user_id?: string;
  [key: string]: unknown;
}

export interface Entitlement {
  id?: string;
  product_id?: string;
  user_id?: string;
  status?: string;
  [key: string]: unknown;
}

export interface Subscription {
  id: string;
  status?: string;
  [key: string]: unknown;
}

export interface TrackEventResponse {
  ok?: boolean;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  path: string;
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}
