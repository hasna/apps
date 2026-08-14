import type { ZohoSignConfig, ZohoSignDataCenter } from '../types';
import { ZohoSignApiError } from '../types';

const DATA_CENTER_HOSTS: Record<ZohoSignDataCenter, string> = {
  com: 'https://sign.zoho.com/api/v1',
  eu: 'https://sign.zoho.eu/api/v1',
  in: 'https://sign.zoho.in/api/v1',
  'com.au': 'https://sign.zoho.com.au/api/v1',
  jp: 'https://sign.zoho.jp/api/v1',
  ca: 'https://sign.zohocloud.ca/api/v1',
};

export function resolveZohoSignBaseUrl(options?: {
  dataCenter?: ZohoSignDataCenter | string;
  baseUrl?: string;
}): string {
  if (options?.baseUrl) {
    return options.baseUrl.replace(/\/$/, '');
  }
  const dc = (options?.dataCenter || 'com') as ZohoSignDataCenter;
  const host = DATA_CENTER_HOSTS[dc];
  if (!host) {
    throw new Error(`Unsupported Zoho Sign data center: ${dc}`);
  }
  return host;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | FormData;
  headers?: Record<string, string>;
  expectJson?: boolean;
}

export class ZohoSignClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: ZohoSignConfig) {
    if (!config.token) {
      throw new Error('Zoho Sign token is required');
    }
    this.token = config.token;
    this.baseUrl = resolveZohoSignBaseUrl({
      dataCenter: config.dataCenter,
      baseUrl: config.baseUrl,
    });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getTokenPreview(): string {
    if (this.token.length > 10) {
      return `${this.token.substring(0, 6)}...${this.token.substring(this.token.length - 4)}`;
    }
    return '***';
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
    const { method = 'GET', params, body, headers = {}, expectJson = true } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body instanceof FormData) {
      fetchOptions.body = body;
    } else if (body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    } else if (!requestHeaders.Accept) {
      requestHeaders.Accept = 'application/json';
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    const isJson = expectJson && contentType.includes('application/json');

    if (!isJson) {
      if (!response.ok) {
        const text = await response.text();
        throw new ZohoSignApiError(text || response.statusText, response.status);
      }
      return (await response.arrayBuffer()) as T;
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      throw new ZohoSignApiError(
        String(data.message || response.statusText),
        response.status,
        data.code as number | string | undefined,
      );
    }

    if (data.status === 'failure') {
      throw new ZohoSignApiError(
        String(data.message || 'Zoho Sign API request failed'),
        response.status,
        data.code as number | string | undefined,
      );
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | FormData,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }
}

export { DATA_CENTER_HOSTS };
