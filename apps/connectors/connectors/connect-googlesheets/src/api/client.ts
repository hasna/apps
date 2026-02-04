import type { GoogleSheetsConfig, OutputFormat } from '../types';
import { GoogleSheetsApiError } from '../types';

const DEFAULT_BASE_URL = 'https://sheets.googleapis.com/v4';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class GoogleSheetsClient {
  private readonly apiKey?: string;
  private accessToken?: string;
  private readonly refreshToken?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly baseUrl: string;
  private tokenExpiresAt?: number;

  constructor(config: GoogleSheetsConfig) {
    if (!config.apiKey && !config.accessToken) {
      throw new Error('Either API key or access token is required');
    }
    this.apiKey = config.apiKey;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  /**
   * Update the access token (e.g., after refresh)
   */
  setAccessToken(token: string, expiresAt?: number): void {
    this.accessToken = token;
    this.tokenExpiresAt = expiresAt;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    // Add API key to params if using API key auth
    if (this.apiKey && !this.accessToken) {
      url.searchParams.append('key', this.apiKey);
    }

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
   * Refresh the access token using refresh token
   */
  async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Refresh token, client ID, and client secret are required to refresh access token');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new GoogleSheetsApiError(`Failed to refresh token: ${error}`, response.status);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    return data.access_token;
  }

  /**
   * Check if token needs refresh and refresh if necessary
   */
  private async ensureValidToken(): Promise<void> {
    if (this.accessToken && this.tokenExpiresAt && this.refreshToken) {
      // Refresh if token expires within 60 seconds
      if (Date.now() >= this.tokenExpiresAt - 60000) {
        await this.refreshAccessToken();
      }
    }
  }

  /**
   * Make an authenticated request to the API
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    // Ensure we have a valid token for OAuth auth
    if (this.accessToken) {
      await this.ensureValidToken();
    }

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Accept': 'application/json',
      ...headers,
    };

    // Add OAuth Bearer token if available
    if (this.accessToken) {
      requestHeaders['Authorization'] = `Bearer ${this.accessToken}`;
    }

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

    // Parse response
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

    // Handle errors
    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new GoogleSheetsApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Check if using OAuth authentication
   */
  isOAuthAuth(): boolean {
    return !!this.accessToken;
  }

  /**
   * Check if using API key authentication
   */
  isApiKeyAuth(): boolean {
    return !!this.apiKey && !this.accessToken;
  }

  /**
   * Get a preview of the auth credentials (for display/debugging)
   */
  getAuthPreview(): string {
    if (this.accessToken) {
      if (this.accessToken.length > 10) {
        return `OAuth: ${this.accessToken.substring(0, 10)}...`;
      }
      return 'OAuth: ***';
    }
    if (this.apiKey) {
      if (this.apiKey.length > 10) {
        return `API Key: ${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
      }
      return 'API Key: ***';
    }
    return 'No auth configured';
  }
}
