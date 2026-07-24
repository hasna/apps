import type { TokenResponse } from '../types';
import { SnovIoApiError, parseApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.snov.io';

export interface SnovIoClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | URLSearchParams;
  headers?: Record<string, string>;
  /** v1 endpoints use access_token query param; v2 use Bearer header */
  authStyle?: 'v1' | 'v2';
  /** Send POST body as application/x-www-form-urlencoded */
  formBody?: boolean;
}

export class SnovIoClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: SnovIoClientConfig) {
    if (!config.clientId) {
      throw new Error('Client ID is required');
    }
    if (!config.clientSecret) {
      throw new Error('Client Secret is required');
    }
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    const response = await fetch(`${this.baseUrl}/v1/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new SnovIoApiError(`Authentication failed: ${text}`, response.status);
    }

    const data = (await response.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    accessToken?: string,
    authStyle: 'v1' | 'v2' = 'v2',
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (authStyle === 'v1' && accessToken) {
      url.searchParams.set('access_token', accessToken);
    }

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      authStyle = 'v2',
      formBody = false,
    } = options;

    const token = await this.getAccessToken();
    const url = this.buildUrl(path, params, token, authStyle);

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...headers,
    };

    if (authStyle === 'v2') {
      requestHeaders.Authorization = `Bearer ${token}`;
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof URLSearchParams || formBody) {
        const form =
          body instanceof URLSearchParams
            ? body
            : new URLSearchParams(
                Object.entries(body as Record<string, string>).map(([k, v]) => [k, String(v)]),
              );
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        fetchOptions.body = form.toString();
      } else {
        requestHeaders['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      data = text ? JSON.parse(text) : {};
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw parseApiError(data, response.status);
    }

    return data as T;
  }

  async getV1<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, authStyle: 'v1' });
  }

  async getV2<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, authStyle: 'v2' });
  }

  async postV2Form<T>(
    path: string,
    body: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null && value !== '') {
        form.set(key, String(value));
      }
    }
    return this.request<T>(path, { method: 'POST', body: form, authStyle: 'v2', formBody: true });
  }

  async raw<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', path: string, options?: {
    params?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
    authStyle?: 'v1' | 'v2';
    formBody?: boolean;
  }): Promise<T> {
    return this.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
      authStyle: options?.authStyle ?? (path.startsWith('/v1') ? 'v1' : 'v2'),
      formBody: options?.formBody,
    });
  }

  getClientIdPreview(): string {
    if (this.clientId.length > 10) {
      return `${this.clientId.substring(0, 6)}...${this.clientId.substring(this.clientId.length - 4)}`;
    }
    return '***';
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
