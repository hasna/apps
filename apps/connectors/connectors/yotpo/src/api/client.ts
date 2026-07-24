import type { YotpoConfig, TokenResponse } from '../types';
import { YotpoApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.yotpo.com';
const DEFAULT_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  auth?: boolean;
}

export class YotpoClient {
  private readonly storeId: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: YotpoConfig) {
    if (!config.storeId) {
      throw new Error('Store ID (app key) is required');
    }
    if (!config.apiSecret) {
      throw new Error('API secret is required');
    }
    this.storeId = config.storeId;
    this.apiSecret = config.apiSecret;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getStoreId(): string {
    return this.storeId;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getStoreIdPreview(): string {
    if (this.storeId.length > 10) {
      return `${this.storeId.substring(0, 6)}...${this.storeId.substring(this.storeId.length - 4)}`;
    }
    return '***';
  }

  async getUtoken(forceRefresh = false): Promise<string> {
    return this.getAccessToken(forceRefresh);
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.storeId,
        client_secret: this.apiSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new YotpoApiError(`Failed to get utoken: ${text}`, response.status);
    }

    const text = await response.text();
    const data = JSON.parse(text) as TokenResponse;
    this.accessToken = data.access_token;
    const ttlMs = data.expires_in
      ? data.expires_in * 1000
      : DEFAULT_TOKEN_TTL_MS;
    this.tokenExpiry = Date.now() + ttlMs;

    return this.accessToken;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      const text = await response.text();
      data = text ? JSON.parse(text) : {};
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new YotpoApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async request<T>(path: string, options: RequestOptions = {}, retryOn401 = true): Promise<T> {
    const { method = 'GET', params, body, headers = {}, auth = true } = options;

    const requestParams = { ...params };
    if (auth) {
      const token = await this.getAccessToken();
      requestParams.utoken = token;
    }

    const url = this.buildUrl(path, requestParams);

    const requestHeaders: Record<string, string> = {
      'Accept': 'application/json',
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

    if (response.status === 401 && auth && retryOn401) {
      await this.getAccessToken(true);
      return this.request<T>(path, options, false);
    }

    return this.parseResponse<T>(response);
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    auth = true,
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, auth });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string,
    params?: Record<string, string | number | boolean | undefined>,
    auth = true,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params, auth });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string | number | boolean | undefined>,
    auth = true,
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params, auth });
  }

  async delete<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    auth = true,
  ): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params, auth });
  }

  async rawRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
      headers?: Record<string, string>;
      auth?: boolean;
    },
  ): Promise<T> {
    return this.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
      headers: options?.headers,
      auth: options?.auth ?? true,
    });
  }
}
