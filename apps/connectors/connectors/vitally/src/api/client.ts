import type { VitallyConfig, VitallyRegion } from '../types';
import { VitallyApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

/** Build HTTP Basic Authorization header (API secret as username, empty password). */
export function buildBasicAuthHeader(apiKey: string): string {
  const encoded = Buffer.from(`${apiKey}:`, 'utf-8').toString('base64');
  return `Basic ${encoded}`;
}

/** Resolve Vitally REST API base URL from config (no trailing slash). */
export function resolveBaseUrl(config: Pick<VitallyConfig, 'baseUrl' | 'subdomain' | 'region'>): string {
  if (config.baseUrl) {
    return config.baseUrl.replace(/\/$/, '');
  }

  const region: VitallyRegion = config.region ?? 'us';
  if (region === 'eu') {
    return 'https://rest.vitally-eu.io';
  }

  const subdomain = config.subdomain?.trim();
  if (!subdomain) {
    throw new Error(
      'Subdomain is required for US Vitally workspaces. Set subdomain in profile or VITALLY_SUBDOMAIN.'
    );
  }

  return `https://${subdomain}.rest.vitally.io`;
}

export class VitallyClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: VitallyConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = resolveBaseUrl(config);
    this.authHeader = config.authHeader?.startsWith('Basic ')
      ? config.authHeader
      : buildBasicAuthHeader(config.apiKey);
  }

  getBaseUrl(): string {
    return this.baseUrl;
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
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: this.authHeader,
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
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

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

    if (!response.ok) {
      const errorData = (data ?? {}) as { message?: string; error?: string };
      throw new VitallyApiError(
        errorData.message || errorData.error || `Vitally API error: ${response.status}`,
        response.status,
        errorData
      );
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | object,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(
    path: string,
    body?: Record<string, unknown> | object,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
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
