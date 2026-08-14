import type { TinesConfig } from '../types';
import { TinesApiError } from '../types';

export type QueryValue = string | number | boolean | undefined;

export interface TinesRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, QueryValue>;
  body?: unknown;
}

function normalizeTenantUrl(tenantUrl: string): string {
  const trimmed = tenantUrl.trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('https://')) {
    throw new Error('Tines tenant URL must start with https://');
  }
  return trimmed;
}

export function buildQuery(params: Record<string, QueryValue>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/**
 * HTTP client for the Tines REST API (Bearer token + tenant URL).
 */
export class TinesClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly tenantRoot: string;

  constructor(config: TinesConfig) {
    if (!config.apiKey?.trim()) {
      throw new Error('Tines API key is required');
    }
    if (!config.tenantUrl?.trim()) {
      throw new Error('Tines tenant URL is required');
    }

    this.apiKey = config.apiKey.trim();
    this.tenantRoot = normalizeTenantUrl(config.tenantUrl);
    this.baseUrl = `${this.tenantRoot}/api/v1`;
  }

  getTenantRoot(): string {
    return this.tenantRoot;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 8) {
      return `${this.apiKey.substring(0, 4)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  async request<T>(path: string, options: TinesRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;
    const query = params ? buildQuery(params) : '';
    const url = `${this.baseUrl}${path}${query}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const record = data as Record<string, unknown>;
      const message =
        (typeof record.error === 'string' && record.error) ||
        (typeof record.message === 'string' && record.message) ||
        response.statusText ||
        `Tines API error (${response.status})`;
      throw new TinesApiError(message, response.status);
    }

    return data as T;
  }

  /**
   * Send a payload to a Tines webhook (no Bearer auth; uses path + secret).
   */
  async sendWebhook<T = unknown>(
    path: string,
    secret: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    if (!path.trim()) throw new Error('Webhook path is required');
    if (!secret.trim()) throw new Error('Webhook secret is required');

    const url = `${this.tenantRoot}/webhook/${encodeURIComponent(path)}/${encodeURIComponent(secret)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const record = data as Record<string, unknown>;
      const message =
        (typeof record.error === 'string' && record.error) ||
        (typeof record.message === 'string' && record.message) ||
        response.statusText ||
        `Webhook request failed (${response.status})`;
      throw new TinesApiError(message, response.status);
    }

    return data as T;
  }
}
