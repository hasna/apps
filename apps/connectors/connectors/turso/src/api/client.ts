import type { TursoConfig } from '../types';
import { TursoApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.turso.tech/v1';

const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
  headers?: Record<string, string>;
}

export class TursoClient {
  private readonly apiKey: string;
  private readonly organization: string;
  private readonly baseUrl: string;

  constructor(config: TursoConfig, baseUrl: string = DEFAULT_BASE_URL) {
    if (!config.apiKey) {
      throw new Error('API token is required');
    }
    if (!config.organization) {
      throw new Error('Organization slug is required');
    }
    this.apiKey = config.apiKey;
    this.organization = config.organization;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  getOrganization(): string {
    return this.organization;
  }

  orgPath(suffix: string): string {
    const encoded = encodeURIComponent(this.organization);
    const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `/organizations/${encoded}${normalized}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private parseErrorMessage(data: unknown, fallback: string): string {
    if (typeof data === 'object' && data !== null) {
      const record = data as Record<string, unknown>;
      if (typeof record.error === 'string') {
        return record.error;
      }
      if (typeof record.message === 'string') {
        return record.message;
      }
    }
    return fallback;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }

    let lastError: TursoApiError | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url, fetchOptions);

      if (response.status === 204) {
        return {} as T;
      }

      let data: unknown;
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const text = await response.text();
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }
      } else {
        data = await response.text();
      }

      if (response.ok) {
        return data as T;
      }

      const message = this.parseErrorMessage(data, response.statusText);
      const error = new TursoApiError(message, response.status);

      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get('retry-after');
        const delayMs = retryAfter ? Number(retryAfter) * 1000 : 2 ** attempt * 250;
        await this.sleep(Number.isFinite(delayMs) ? delayMs : 250);
        lastError = error;
        continue;
      }

      throw error;
    }

    throw lastError ?? new TursoApiError('Request failed after retries', 500);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
