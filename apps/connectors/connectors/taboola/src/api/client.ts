import type { ConnectorConfig, OutputFormat, TokenResponse } from '../types';
import { ConnectorApiError, parseApiError } from '../types';

// Taboola Backstage base. The API lives under `${BASE}/api/1.0` and the
// OAuth2 token endpoint under `${BASE}/oauth/token`.
const DEFAULT_BASE_URL = 'https://backstage.taboola.com/backstage';
const API_PREFIX = '/api/1.0';
const TOKEN_PATH = '/oauth/token';

// Refresh a client-credentials token this many ms before it expires.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  retries?: number;
  timeout?: number;
}

export class ConnectorClient {
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly baseUrl: string;

  private accessToken?: string;
  private tokenExpiresAt = 0;

  constructor(config: ConnectorConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');

    if (config.accessToken) {
      // A pre-issued Bearer token; assume valid until an auth error forces a refresh.
      this.accessToken = config.accessToken;
      this.tokenExpiresAt = Number.MAX_SAFE_INTEGER;
    }

    if (!config.accessToken && !(config.clientId && config.clientSecret)) {
      throw new Error(
        'Taboola credentials are required: provide either an access token or a client id and client secret'
      );
    }
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): string {
    const url = new URL(`${this.baseUrl}${API_PREFIX}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, baseDelay = 1000): number {
    return baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  /**
   * Obtain a valid Bearer access token, fetching a new one via the
   * OAuth2 client_credentials flow when needed.
   */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (
      !forceRefresh &&
      this.accessToken &&
      Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS
    ) {
      return this.accessToken;
    }

    if (!this.clientId || !this.clientSecret) {
      if (this.accessToken) {
        // Static token supplied but expired/rejected and no credentials to refresh.
        return this.accessToken;
      }
      throw new Error('No client credentials available to obtain an access token');
    }

    const response = await fetch(`${this.baseUrl}${TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    const text = await response.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      throw parseApiError(data, response.status);
    }

    const token = data as TokenResponse;
    if (!token?.access_token) {
      throw new ConnectorApiError('Token endpoint did not return an access_token', response.status);
    }

    this.accessToken = token.access_token;
    // Taboola access tokens are valid for 12h; honor expires_in when provided.
    const expiresInMs = (token.expires_in ?? 12 * 60 * 60) * 1000;
    this.tokenExpiresAt = Date.now() + expiresInMs;

    return this.accessToken;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, retries = 3, timeout = 30000 } = options;

    const url = this.buildUrl(path, params);

    let lastError: Error | null = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const token = await this.getAccessToken(attempt > 0 && lastStatus === 401);

        const requestHeaders: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...headers,
        };

        const fetchOptions: RequestInit = { method, headers: requestHeaders };

        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          requestHeaders['Content-Type'] = 'application/json';
          fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        clearTimeout(timeoutId);
        lastStatus = response.status;

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
          // Retry once on 401 with a forced token refresh (static token may be stale).
          if (response.status === 401 && attempt < retries) {
            this.tokenExpiresAt = 0;
            continue;
          }

          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }

          throw parseApiError(data, response.status);
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }

        if (attempt < retries && !(err instanceof ConnectorApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }

        throw err;
      }
    }

    throw lastError || new ConnectorApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(
    path: string,
    body?: Record<string, unknown> | object,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  isAuthenticated(): boolean {
    return Boolean(this.accessToken || (this.clientId && this.clientSecret));
  }

  getClientIdPreview(): string {
    if (this.clientId && this.clientId.length > 8) {
      return `${this.clientId.substring(0, 4)}...${this.clientId.substring(this.clientId.length - 4)}`;
    }
    return this.clientId ? '***' : '(access token)';
  }
}
