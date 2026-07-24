// Tave API Types
//
// Tave is a studio-management CRM (contacts, jobs/shoots, leads, and orders).
// The public API is served under https://tave.io/v2 with Bearer-token auth.

// ============================================
// Configuration
// ============================================

export interface ConnectorConfig {
  apiKey?: string; // API key used as the Bearer token
  token?: string;  // Alias for apiKey
  baseUrl?: string; // Override default base URL (https://tave.io/v2)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface ListParams {
  page?: number;
  perPage?: number;
  search?: string;
  status?: string;
}

// Tave list endpoints are read forgivingly: responses may be a bare array or
// an object envelope, so downstream code should not rely on a fixed wrapper.
export type ListResponse<T> = T[] | { data?: T[]; results?: T[]; [key: string]: unknown };

// ============================================
// Resource Types
//
// Tave's public API schema is not exhaustively documented, so the resource
// interfaces below capture the commonly present fields and keep an index
// signature so additional fields are preserved rather than dropped.
// ============================================

export interface Contact {
  id?: string | number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  date_created?: string;
  [key: string]: unknown;
}

export interface Job {
  id?: string | number;
  name?: string;
  type?: string;
  status?: string;
  date?: string;
  date_created?: string;
  contact_id?: string | number;
  [key: string]: unknown;
}

export interface Lead {
  id?: string | number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  status?: string;
  source?: string;
  event_type?: string;
  event_date?: string;
  message?: string;
  date_created?: string;
  [key: string]: unknown;
}

export interface CreateLeadParams {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  source?: string;
  event_type?: string;
  event_date?: string;
  message?: string;
  [key: string]: unknown;
}

export interface Order {
  id?: string | number;
  job_id?: string | number;
  contact_id?: string | number;
  status?: string;
  total?: number;
  balance?: number;
  currency?: string;
  date_created?: string;
  [key: string]: unknown;
}

// ============================================
// API Error Types
// ============================================

export class ConnectorApiError extends Error {
  public readonly statusCode: number;
  public readonly body?: unknown;

  constructor(message: string, statusCode: number, body?: unknown) {
    super(message);
    this.name = 'ConnectorApiError';
    this.statusCode = statusCode;
    this.body = body;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }

  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  getUserMessage(): string {
    switch (this.statusCode) {
      case 400:
        return 'Bad request. Please check your input.';
      case 401:
        return 'Authentication failed. Please check your API key.';
      case 403:
        return 'Access denied. You do not have permission to perform this action.';
      case 404:
        return 'Resource not found.';
      case 429:
        return 'Rate limit exceeded. Please wait and try again.';
      case 500:
        return 'Server error. Please try again later.';
      default:
        return this.message;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      body: this.body,
    };
  }
}

export function parseApiError(response: unknown, statusCode: number): ConnectorApiError {
  if (typeof response === 'string' && response) {
    return new ConnectorApiError(response, statusCode, response);
  }

  if (!response || typeof response !== 'object') {
    return new ConnectorApiError(`HTTP ${statusCode} Error`, statusCode, response);
  }

  const data = response as Record<string, unknown>;
  const message =
    (data.message as string) ||
    (data.error as string) ||
    (data.error_description as string) ||
    (typeof data.errors === 'string' ? (data.errors as string) : undefined) ||
    `HTTP ${statusCode} Error`;

  return new ConnectorApiError(message, statusCode, response);
}
