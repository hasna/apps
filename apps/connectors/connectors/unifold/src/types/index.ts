// Unifold Connector Types
// Cross-chain deposit API

export interface UnifoldConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface UnifoldApiErrorBody {
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export class UnifoldApiError extends Error {
  readonly status: number;
  readonly body?: UnifoldApiErrorBody;

  constructor(message: string, status: number, body?: UnifoldApiErrorBody) {
    super(message);
    this.name = 'UnifoldApiError';
    this.status = status;
    this.body = body;
  }
}

// ============================================
// Resource types (permissive — public schema limited)
// ============================================

export interface UnifoldUser {
  id: string;
  email?: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PaymentIntent {
  id: string;
  amount?: number;
  currency?: string;
  status?: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface TreasuryAccount {
  id: string;
  userId?: string;
  network?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface DepositAddress {
  id?: string;
  accountId?: string;
  address?: string;
  network?: string;
  currency?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ListResponse<T> {
  data?: T[];
  items?: T[];
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface CreatePaymentIntentRequest {
  amount: number;
  currency: string;
  userId: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CreateTreasuryAccountRequest {
  userId: string;
  network: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}
