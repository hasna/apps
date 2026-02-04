import type { GoogleContactsConfig, OAuthTokenResponse, OAuthTokens } from '../types';
import { GoogleContactsApiError, AuthError, RateLimitError } from '../types';

const DEFAULT_BASE_URL = 'https://people.googleapis.com';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_SCOPES = 'https://www.googleapis.com/auth/contacts';
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY_REQUESTS = 429;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
}

export class GoogleContactsClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly redirectUri: string;
  private tokens: OAuthTokens;

  constructor(config: GoogleContactsConfig) {
    if (!config.clientId) {
      throw new Error('Client ID is required');
    }
    if (!config.clientSecret) {
      throw new Error('Client Secret is required');
    }
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.redirectUri = config.redirectUri || 'urn:ietf:wg:oauth:2.0:oob';
    this.tokens = {
      accessToken: config.accessToken || '',
      refreshToken: config.refreshToken,
      expiresAt: undefined,
    };
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(scopes: string = DEFAULT_SCOPES): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${OAUTH_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<OAuthTokens> {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AuthError(`Token exchange failed: ${errorText}`);
    }

    const data: OAuthTokenResponse = await response.json();
    this.tokens = this.parseTokenResponse(data);
    return this.tokens;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<OAuthTokens> {
    if (!this.tokens.refreshToken) {
      throw new AuthError('Missing refresh token; cannot refresh access token.');
    }

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AuthError(`Token refresh failed: ${errorText}`);
    }

    const data: OAuthTokenResponse = await response.json();
    const newTokens = this.parseTokenResponse(data);

    // Preserve existing refresh_token when Google omits it on refresh
    if (!newTokens.refreshToken) {
      newTokens.refreshToken = this.tokens.refreshToken;
    }

    this.tokens = newTokens;
    return this.tokens;
  }

  /**
   * Set tokens directly (e.g., from stored config)
   */
  setTokens(tokens: Partial<OAuthTokens>): void {
    if (tokens.accessToken) {
      this.tokens.accessToken = tokens.accessToken;
    }
    if (tokens.refreshToken) {
      this.tokens.refreshToken = tokens.refreshToken;
    }
    if (tokens.expiresAt) {
      this.tokens.expiresAt = tokens.expiresAt;
    }
  }

  /**
   * Get current tokens
   */
  getTokens(): OAuthTokens {
    return { ...this.tokens };
  }

  /**
   * Check if access token is expired
   */
  isTokenExpired(): boolean {
    if (!this.tokens.expiresAt) return false;
    // Consider expired 60 seconds before actual expiry
    return Date.now() >= (this.tokens.expiresAt - 60000);
  }

  /**
   * Ensure we have a valid access token
   */
  async ensureValidToken(): Promise<void> {
    if (!this.tokens.accessToken) {
      throw new AuthError('Missing access token. Run OAuth flow first.');
    }
    if (this.isTokenExpired() && this.tokens.refreshToken) {
      await this.refreshAccessToken();
    }
  }

  private parseTokenResponse(data: OAuthTokenResponse): OAuthTokens {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type,
      scope: data.scope,
    };
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

  private getAuthHeaders(): Record<string, string> {
    if (!this.tokens.accessToken) {
      throw new AuthError('Missing access token. Run OAuth flow first.');
    }
    return {
      'Authorization': `Bearer ${this.tokens.accessToken}`,
    };
  }

  /**
   * Make an authenticated request to the API with retry logic
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    await this.ensureValidToken();
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      ...this.getAuthHeaders(),
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

    let response = await fetch(url, fetchOptions);

    // Handle 401 - try refresh once
    if (response.status === HTTP_UNAUTHORIZED && this.tokens.refreshToken) {
      await this.refreshAccessToken();
      requestHeaders['Authorization'] = `Bearer ${this.tokens.accessToken}`;
      response = await fetch(url, {
        ...fetchOptions,
        headers: requestHeaders,
      });
    }

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
      if (response.status === HTTP_TOO_MANY_REQUESTS) {
        throw new RateLimitError();
      }
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new GoogleContactsApiError(errorMessage, response.status);
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
   * Get a preview of the client ID (for display/debugging)
   */
  getClientIdPreview(): string {
    if (this.clientId.length > 10) {
      return `${this.clientId.substring(0, 10)}...${this.clientId.substring(this.clientId.length - 4)}`;
    }
    return '***';
  }
}
