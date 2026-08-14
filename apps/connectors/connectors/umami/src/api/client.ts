import type { UmamiConfig, UmamiRegion } from '../types';
import { UmamiApiError, parseApiError } from '../types';

const CLOUD_ORIGIN = 'https://api.umami.is';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | object;
}

/**
 * Resolve Umami API base URL for cloud or self-hosted instances.
 * Cloud: https://api.umami.is/v1[/us|/eu]
 * Self-hosted: {host}/api
 */
export function buildBaseUrl(config: Pick<UmamiConfig, 'host' | 'baseUrl' | 'region'>): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/+$/, '');
  }

  const host = (config.host || `${CLOUD_ORIGIN}/v1`).replace(/\/+$/, '');

  if (!host.includes('api.umami.is')) {
    if (host.endsWith('/api')) {
      return host;
    }
    return `${host}/api`;
  }

  let base = host.includes('/v1') ? host : `${CLOUD_ORIGIN}/v1`;
  if (config.region) {
    base = `${base}/${config.region}`;
  }
  return base;
}

export function buildQueryParams(
  params?: Record<string, string | number | boolean | undefined>
): Record<string, string> {
  const query: Record<string, string> = {};
  if (!params) return query;

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query[key] = String(value);
    }
  }
  return query;
}

export class UmamiClient {
  readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: UmamiConfig) {
    if (!config.apiKey) {
      throw new Error('Umami API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = buildBaseUrl(config);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getRegionFromBaseUrl(): UmamiRegion | undefined {
    if (this.baseUrl.endsWith('/us')) return 'us';
    if (this.baseUrl.endsWith('/eu')) return 'eu';
    return undefined;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;
    const url = this.buildUrl(path, params);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'x-umami-api-key': this.apiKey,
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      const text = await response.text();
      data = text ? JSON.parse(text) : {};
    } else {
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      throw parseApiError(data, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | object,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }
}

export { UmamiApiError };
