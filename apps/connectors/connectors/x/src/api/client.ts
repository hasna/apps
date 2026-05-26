import type { XConfig, OutputFormat, AuthMethod, AuthStatus } from '../types';
import { XApiError } from '../types';
import { refreshAccessToken, type OAuth2Config } from './oauth';
import { OAuth1Client } from './oauth1';

const DEFAULT_BASE_URL = 'https://api.twitter.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | string[] | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
  // Force a specific auth method
  authMethod?: AuthMethod;
}

export class XClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private bearerToken?: string;
  private readonly baseUrl: string;

  // OAuth 2.0 user tokens
  private accessToken?: string;
  private refreshToken?: string;
  private tokenExpiresAt?: number;

  // OAuth 2.0 client credentials (for refresh)
  private clientId?: string;
  private clientSecret?: string;

  // OAuth 1.0a client (for legacy endpoints)
  private oauth1Client?: OAuth1Client;

  // Callback to save refreshed tokens
  private onTokenRefresh?: (tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  }) => void;

  constructor(config: XConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error('API key and API secret are required');
    }
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.bearerToken = config.bearerToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;

    // OAuth 2.0 user tokens
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.tokenExpiresAt = config.tokenExpiresAt;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;

    // OAuth 1.0a setup
    if (config.oauth1AccessToken && config.oauth1AccessTokenSecret) {
      this.oauth1Client = new OAuth1Client({
        consumerKey: config.apiKey,
        consumerSecret: config.apiSecret,
        accessToken: config.oauth1AccessToken,
        accessTokenSecret: config.oauth1AccessTokenSecret,
      });
    }
  }

  /**
   * Set callback for token refresh events
   */
  setTokenRefreshCallback(
    callback: (tokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt: number;
    }) => void
  ): void {
    this.onTokenRefresh = callback;
  }

  /**
   * Get OAuth 2.0 Bearer token using client credentials (app-only)
   */
  private async getAppBearerToken(): Promise<string> {
    if (this.bearerToken) {
      return this.bearerToken;
    }

    const credentials = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');

    const response = await fetch(`${this.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new XApiError(`Failed to get bearer token: ${errorText}`, response.status);
    }

    const data = (await response.json()) as { access_token: string };
    this.bearerToken = data.access_token;
    return this.bearerToken;
  }

  /**
   * Check if user access token is expired
   */
  private isTokenExpired(): boolean {
    if (!this.tokenExpiresAt) return true;
    // Consider expired 5 minutes before actual expiry
    return Date.now() > this.tokenExpiresAt - 5 * 60 * 1000;
  }

  /**
   * Refresh the user access token
   */
  private async refreshUserToken(): Promise<string> {
    if (!this.refreshToken || !this.clientId) {
      throw new Error('Cannot refresh token: missing refresh token or client ID');
    }

    const oauth2Config: OAuth2Config = {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: 'http://localhost:3000/callback', // Not used for refresh
    };

    const tokens = await refreshAccessToken(oauth2Config, this.refreshToken);

    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken || this.refreshToken;
    this.tokenExpiresAt = tokens.expiresAt;

    // Notify about token refresh
    if (this.onTokenRefresh) {
      this.onTokenRefresh({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });
    }

    return this.accessToken;
  }

  /**
   * Get the appropriate access token for requests
   */
  private async getAccessToken(preferUser: boolean = true): Promise<{ token: string; isUserContext: boolean }> {
    // If user token available and preferred
    if (preferUser && this.accessToken) {
      // Check if expired and can refresh
      if (this.isTokenExpired() && this.refreshToken && this.clientId) {
        const token = await this.refreshUserToken();
        return { token, isUserContext: true };
      }

      if (!this.isTokenExpired()) {
        return { token: this.accessToken, isUserContext: true };
      }
    }

    // Fall back to app-only token
    const token = await this.getAppBearerToken();
    return { token, isUserContext: false };
  }

  /**
   * Determine the auth method to use
   */
  getAuthMethod(): AuthMethod {
    if (this.accessToken && !this.isTokenExpired()) {
      return 'oauth2-user';
    }
    if (this.oauth1Client?.hasUserTokens()) {
      return 'oauth1-user';
    }
    return 'app-only';
  }

  /**
   * Get auth status
   */
  getAuthStatus(): AuthStatus {
    const method = this.getAuthMethod();

    return {
      method,
      isAuthenticated: method !== 'app-only',
      expiresAt: this.tokenExpiresAt,
      hasOAuth1: this.oauth1Client?.hasUserTokens(),
    };
  }

  /**
   * Check if we have user context (OAuth 2.0)
   */
  hasUserContext(): boolean {
    return !!(this.accessToken && !this.isTokenExpired());
  }

  /**
   * Check if we have OAuth 1.0a credentials
   */
  hasOAuth1(): boolean {
    return this.oauth1Client?.hasUserTokens() ?? false;
  }

  /**
   * Get the OAuth 1.0a client (for media uploads)
   */
  getOAuth1Client(): OAuth1Client | undefined {
    return this.oauth1Client;
  }

  /**
   * Set user tokens (for after OAuth flow)
   */
  setUserTokens(tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.tokenExpiresAt = tokens.expiresAt;
  }

  /**
   * Set OAuth 1.0a tokens
   */
  setOAuth1Tokens(oauthToken: string, oauthTokenSecret: string): void {
    this.oauth1Client = new OAuth1Client({
      consumerKey: this.apiKey,
      consumerSecret: this.apiSecret,
      accessToken: oauthToken,
      accessTokenSecret: oauthTokenSecret,
    });
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | string[] | undefined>
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            url.searchParams.append(key, value.join(','));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    return url.toString();
  }

  /**
   * Make an authenticated request to the X API v2
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, authMethod } = options;

    // Determine if we should prefer user context
    // POST/DELETE operations typically require user context
    const preferUser = authMethod === 'oauth2-user' || authMethod === 'oauth1-user' || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    const url = this.buildUrl(path, params);

    // For write operations, try OAuth 1.0a if OAuth 2.0 is not available
    const isWriteOp = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const useOAuth1 = authMethod === 'oauth1-user' || (isWriteOp && !this.accessToken && this.oauth1Client?.hasUserTokens());

    let requestHeaders: Record<string, string>;

    if (useOAuth1 && this.oauth1Client) {
      // Use OAuth 1.0a for authentication
      const oauth1Header = this.oauth1Client.buildAuthHeader(method, url);
      requestHeaders = {
        Authorization: oauth1Header,
        Accept: 'application/json',
        ...headers,
      };
    } else {
      // Use Bearer token (OAuth 2.0 user or app-only)
      const { token } = await this.getAccessToken(preferUser);
      requestHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...headers,
      };
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
      const errorMessage =
        typeof data === 'object' && data !== null
          ? JSON.stringify(data)
          : String(data || response.statusText);
      throw new XApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | string[] | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    params?: Record<string, string | number | boolean | string[] | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async delete<T>(
    path: string,
    params?: Record<string, string | number | boolean | string[] | undefined>
  ): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a preview of the API key (for display/debugging)
   */
  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }

  /**
   * Check if bearer token is set
   */
  hasBearerToken(): boolean {
    return !!this.bearerToken;
  }
}
