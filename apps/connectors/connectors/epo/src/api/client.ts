import type { EPOConfig, OAuthToken, OAuthTokenResponse } from '../types';
import { EPOApiError } from '../types';
import { loadToken, saveToken, clearToken } from '../utils/config';

const DEFAULT_BASE_URL = 'https://ops.epo.org/3.2/rest-services';
const TOKEN_ENDPOINT = 'https://ops.epo.org/3.2/auth/accesstoken';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  accept?: string; // Accept header, defaults to application/json
}

export class EPOClient {
  private readonly consumerKey: string;
  private readonly consumerSecret: string;
  private readonly baseUrl: string;
  private token: OAuthToken | null = null;

  constructor(config: EPOConfig) {
    if (!config.consumerKey) {
      throw new Error('Consumer key is required');
    }
    if (!config.consumerSecret) {
      throw new Error('Consumer secret is required');
    }
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;

    // Try to load cached token
    this.loadCachedToken();
  }

  private loadCachedToken(): void {
    const stored = loadToken();
    if (stored && stored.expiresAt > Date.now()) {
      this.token = {
        accessToken: stored.accessToken,
        tokenType: 'Bearer',
        expiresIn: Math.floor((stored.expiresAt - Date.now()) / 1000),
        expiresAt: stored.expiresAt,
      };
    }
  }

  /**
   * Get an OAuth2 access token using client credentials grant
   */
  async authenticate(): Promise<void> {
    // Check if current token is still valid (with 60 second buffer)
    if (this.token && this.token.expiresAt > Date.now() + 60000) {
      return;
    }

    const credentials = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new EPOApiError(`Authentication failed: ${text}`, response.status);
    }

    const data = await response.json() as OAuthTokenResponse;

    this.token = {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    // Cache the token
    saveToken({
      accessToken: this.token.accessToken,
      expiresAt: this.token.expiresAt,
    });
  }

  /**
   * Clear the cached token (force re-authentication)
   */
  clearToken(): void {
    this.token = null;
    clearToken();
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
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

  /**
   * Make an authenticated request to the EPO OPS API
   * Automatically handles OAuth2 token refresh
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    // Ensure we have a valid token
    await this.authenticate();

    const { method = 'GET', params, body, headers = {}, accept = 'application/json' } = options;

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.token!.accessToken}`,
      'Accept': accept,
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

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Handle 401 - token might have expired, try to refresh
    if (response.status === 401) {
      this.clearToken();
      await this.authenticate();
      // Retry the request once
      const retryHeaders = { ...requestHeaders, 'Authorization': `Bearer ${this.token!.accessToken}` };
      const retryResponse = await fetch(url, { ...fetchOptions, headers: retryHeaders });

      if (!retryResponse.ok) {
        const text = await retryResponse.text();
        throw new EPOApiError(text || retryResponse.statusText, retryResponse.status);
      }

      return this.parseResponse<T>(retryResponse);
    }

    // Handle errors
    if (!response.ok) {
      const text = await response.text();
      throw new EPOApiError(text || response.statusText, response.status);
    }

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          return JSON.parse(text) as T;
        } catch {
          return text as unknown as T;
        }
      }
      return {} as T;
    }

    if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
      // Return raw XML for parsing by the caller
      return await response.text() as unknown as T;
    }

    return await response.text() as unknown as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, accept?: string): Promise<T> {
    return this.request<T>(path, { method: 'GET', params, accept });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a preview of the consumer key (for display/debugging)
   */
  getConsumerKeyPreview(): string {
    if (this.consumerKey.length > 10) {
      return `${this.consumerKey.substring(0, 6)}...${this.consumerKey.substring(this.consumerKey.length - 4)}`;
    }
    return '***';
  }

  /**
   * Check if we have a valid token
   */
  hasValidToken(): boolean {
    return this.token !== null && this.token.expiresAt > Date.now();
  }

  /**
   * Get token expiry time
   */
  getTokenExpiry(): Date | null {
    return this.token ? new Date(this.token.expiresAt) : null;
  }
}
