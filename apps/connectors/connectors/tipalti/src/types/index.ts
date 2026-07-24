// Tipalti Connector Types
// Global payments platform — payees, events, search

export interface TipaltiConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export interface Payee {
  id?: string;
  refCode?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  status?: string;
  paymentMethod?: string;
  country?: string;
  [key: string]: unknown;
}

export interface CreatePayeeRequest {
  refCode?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  country?: string;
  paymentMethod?: string;
  [key: string]: unknown;
}

export interface PayeeListResponse {
  payees?: Payee[];
  items?: Payee[];
  totalCount?: number;
  [key: string]: unknown;
}

export interface TipaltiEvent {
  id?: string;
  type?: string;
  createdDate?: string;
  payeeId?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EventListResponse {
  events?: TipaltiEvent[];
  items?: TipaltiEvent[];
  totalCount?: number;
  [key: string]: unknown;
}

export interface SearchRequest {
  query?: string;
  entityType?: string;
  filters?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}

export interface SearchResponse {
  results?: unknown[];
  items?: unknown[];
  totalCount?: number;
  [key: string]: unknown;
}

export interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export interface TipaltiApiErrorBody {
  message?: string;
  error?: string;
  errors?: Array<{ message?: string; code?: string }>;
}

export class TipaltiApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: TipaltiApiErrorBody;

  constructor(message: string, statusCode: number, body?: TipaltiApiErrorBody) {
    super(message);
    this.name = 'TipaltiApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}
