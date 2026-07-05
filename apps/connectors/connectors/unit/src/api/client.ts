import type {
  UnitConfig,
  UnitEnvironment,
  QueryValue,
  JsonApiDocument,
  JsonApiError,
} from '../types';
import { UnitApiError } from '../types';

const ENV_BASES: Record<UnitEnvironment, string> = {
  production: 'https://api.unit.sh',
  sandbox: 'https://api.s.unit.sh',
};

export interface UnitRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Build a query string supporting JSON:API bracketed filters and array params.
 */
export function buildQuery(
  params: Record<string, QueryValue> = {},
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) query.append(key, String(item));
    } else if (value !== '') {
      query.set(key, String(value));
    }
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/**
 * Build a JSON:API request body envelope.
 */
export function jsonApiBody(
  type: string,
  attributes: Record<string, unknown>,
  relationships?: Record<string, unknown>,
): { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { type, attributes };
  if (relationships) data.relationships = relationships;
  return { data };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseJsonApiError(data: unknown, status: number): UnitApiError {
  const record = asRecord(data);
  const errors = Array.isArray(record.errors) ? (record.errors as JsonApiError[]) : [];
  const first = errors[0];
  const message = first?.detail ?? first?.title ?? `Unit API request failed (${status})`;
  return new UnitApiError(message, status, errors);
}

/**
 * Unit.sh JSON:API HTTP client.
 */
export class UnitClient {
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(config: UnitConfig) {
    if (!config.apiToken?.trim()) {
      throw new Error('Unit API token is required');
    }
    this.apiToken = config.apiToken.trim();
    const env = (config.environment ?? 'sandbox').toLowerCase() as UnitEnvironment;
    const base = ENV_BASES[env];
    if (!base) {
      throw new Error(`Unit environment must be one of: ${Object.keys(ENV_BASES).join(', ')}`);
    }
    this.baseUrl = base;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getTokenPreview(): string {
    if (this.apiToken.length > 10) {
      return `${this.apiToken.substring(0, 6)}...${this.apiToken.substring(this.apiToken.length - 4)}`;
    }
    return '***';
  }

  async request<T = JsonApiDocument>(
    path: string,
    options: UnitRequestOptions = {},
  ): Promise<T> {
    const { method = 'GET', query, body, headers = {} } = options;
    const url = `${this.baseUrl}${path}${buildQuery(query ?? {})}`;

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: 'application/vnd.api+json',
      ...headers,
    };

    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/vnd.api+json';
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      throw parseJsonApiError(data, response.status);
    }

    return data as T;
  }

  async get<T = JsonApiDocument>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'GET', query });
  }

  async post<T = JsonApiDocument>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, query });
  }

  async patch<T = JsonApiDocument>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, query });
  }

  async delete<T = JsonApiDocument>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', query });
  }
}

export { ENV_BASES };
