import type { TrustpilotBusinessConfig, TokenResponse } from '../types';
import { TrustpilotBusinessApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.trustpilot.com/v1';
export const DEFAULT_INVITATIONS_BASE_URL = 'https://invitations-api.trustpilot.com/v1';
const TOKEN_PATH = '/oauth/oauth-business-users-for-applications/accesstoken';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined | string[] | number[]>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  baseUrl?: string;
  privateAuth?: boolean;
}

export class TrustpilotBusinessClient {
  private readonly apiKey: string;
  private readonly apiSecret?: string;
  private readonly baseUrl: string;
  private readonly invitationsBaseUrl: string;
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(config: TrustpilotBusinessConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.invitationsBaseUrl = config.invitationsBaseUrl || DEFAULT_INVITATIONS_BASE_URL;
  }

  getInvitationsBaseUrl(): string {
    return this.invitationsBaseUrl;
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  private buildUrl(base: string, path: string, params?: RequestOptions['params']): string {
    const url = new URL(`${base}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async getAccessToken(): Promise<string> {
    if (!this.apiSecret) {
      throw new Error('API secret is required for private API routes');
    }

    if (this.accessToken && Date.now() < this.tokenExpiry - 60_000) {
      return this.accessToken;
    }

    const authString = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
    const response = await fetch(`${this.baseUrl}${TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authString}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new TrustpilotBusinessApiError(`Failed to obtain access token: ${text}`, response.status);
    }

    const data = await response.json() as TokenResponse;
    this.accessToken = data.access_token;
    const expiresIn = typeof data.expires_in === 'string' ? Number(data.expires_in) : data.expires_in;
    this.tokenExpiry = Date.now() + expiresIn * 1000;
    return this.accessToken;
  }

  private usesPrivateAuth(path: string, privateAuth?: boolean): boolean {
    return privateAuth ?? path.startsWith('/private/');
  }

  private async buildAuthHeaders(path: string, privateAuth?: boolean): Promise<Record<string, string>> {
    if (this.usesPrivateAuth(path, privateAuth)) {
      const token = await this.getAccessToken();
      return { Authorization: `Bearer ${token}` };
    }
    return { apikey: this.apiKey };
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      baseUrl = this.baseUrl,
      privateAuth,
    } = options;

    const url = this.buildUrl(baseUrl, path, params);
    const authHeaders = await this.buildAuthHeaders(path, privateAuth);

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...authHeaders,
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
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
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new TrustpilotBusinessApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(
    path: string,
    params?: RequestOptions['params'],
    options: Omit<RequestOptions, 'method' | 'params' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | object,
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body: body as Record<string, unknown> });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | object,
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body: body as Record<string, unknown> });
  }

  async delete<T>(
    path: string,
    params?: RequestOptions['params'],
    options: Omit<RequestOptions, 'method' | 'params' | 'body'> = {},
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE', params });
  }
}
