import type { RedditConfig, OAuthTokenResponse } from '../types';
import { RedditApiError } from '../types';
import {
  getAccessToken,
  getRefreshToken,
  getClientId,
  getClientSecret,
  isTokenExpired,
  saveTokens,
} from '../utils/config';

const REDDIT_API_BASE = 'https://oauth.reddit.com';
const REDDIT_AUTH_BASE = 'https://www.reddit.com';
const DEFAULT_USER_AGENT = 'connect-reddit/0.0.1 (by /u/connect-reddit)';

export interface RedditRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | string;
  headers?: Record<string, string>;
  isFormData?: boolean;
}

/**
 * Reddit API Client with OAuth2 authentication
 */
export class RedditClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken?: string;
  private refreshToken?: string;
  private tokenExpiresAt?: number;
  private readonly userAgent: string;

  constructor(config: RedditConfig) {
    if (!config.clientId) {
      throw new Error('Reddit Client ID is required');
    }
    if (!config.clientSecret) {
      throw new Error('Reddit Client Secret is required');
    }
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.tokenExpiresAt = config.tokenExpiresAt;
    this.userAgent = config.userAgent || DEFAULT_USER_AGENT;
  }

  /**
   * Get the OAuth2 authorization URL
   */
  static getAuthorizationUrl(
    clientId: string,
    redirectUri: string,
    scope: string[],
    state: string,
    duration: 'temporary' | 'permanent' = 'permanent'
  ): string {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      state,
      redirect_uri: redirectUri,
      duration,
      scope: scope.join(' '),
    });
    return `${REDDIT_AUTH_BASE}/api/v1/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
  ): Promise<OAuthTokenResponse> {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(`${REDDIT_AUTH_BASE}/api/v1/access_token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': DEFAULT_USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new RedditApiError(`Failed to exchange code: ${text}`, response.status);
    }

    return response.json() as Promise<OAuthTokenResponse>;
  }

  /**
   * Refresh the access token
   */
  async refreshAccessToken(): Promise<void> {
    const refreshToken = this.refreshToken || getRefreshToken();
    if (!refreshToken) {
      throw new RedditApiError('No refresh token available. Please re-authenticate.', 401);
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(`${REDDIT_AUTH_BASE}/api/v1/access_token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new RedditApiError(`Failed to refresh token: ${text}`, response.status);
    }

    const data = await response.json() as OAuthTokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);

    // Save tokens to config
    saveTokens(data.access_token, data.refresh_token || refreshToken, data.expires_in, data.scope);
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getValidAccessToken(): Promise<string> {
    // Try to get token from instance or config
    let token = this.accessToken || getAccessToken();

    // Check if token is expired
    const expired = this.tokenExpiresAt
      ? Date.now() >= (this.tokenExpiresAt - 60000)
      : isTokenExpired();

    if (!token || expired) {
      await this.refreshAccessToken();
      token = this.accessToken || getAccessToken();
    }

    if (!token) {
      throw new RedditApiError('No access token available. Please authenticate first.', 401);
    }

    return token;
  }

  /**
   * Make a request to the Reddit API
   */
  async request<T>(
    endpoint: string,
    options: RedditRequestOptions = {}
  ): Promise<T> {
    const { method = 'GET', params, body, headers = {}, isFormData = false } = options;

    const accessToken = await this.getValidAccessToken();
    const url = new URL(`${REDDIT_API_BASE}${endpoint}`);

    // Add query params
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    // Prepare request headers
    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': this.userAgent,
      ...headers,
    };

    // Prepare body
    let requestBody: string | undefined;
    if (body) {
      if (isFormData) {
        requestHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        if (typeof body === 'object') {
          const formData = new URLSearchParams();
          Object.entries(body).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
              formData.append(key, String(value));
            }
          });
          requestBody = formData.toString();
        } else {
          requestBody = body;
        }
      } else {
        requestHeaders['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(body);
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: requestHeaders,
      body: requestBody,
    });

    // Handle rate limiting
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    const rateLimitReset = response.headers.get('x-ratelimit-reset');

    if (response.status === 429) {
      const resetIn = rateLimitReset ? parseInt(rateLimitReset) : 60;
      throw new RedditApiError(
        `Rate limited. Try again in ${resetIn} seconds.`,
        429,
        'RATE_LIMITED'
      );
    }

    // Parse response
    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      let errorMessage = `Reddit API Error: ${response.status} ${response.statusText}`;
      let errorCode: string | undefined;

      if (typeof data === 'object' && data !== null) {
        const errData = data as Record<string, unknown>;
        if (errData.error) {
          errorCode = String(errData.error);
          errorMessage = String(errData.message || errData.error_description || errorMessage);
        }
        if (errData.json) {
          const jsonData = errData.json as Record<string, unknown>;
          if (jsonData.errors && Array.isArray(jsonData.errors)) {
            const errors = jsonData.errors as string[][];
            errorMessage = errors.map(e => e.join(': ')).join('; ');
          }
        }
      }

      throw new RedditApiError(errorMessage, response.status, errorCode);
    }

    return data as T;
  }

  /**
   * Get rate limit info from last request headers
   */
  getRateLimitInfo(): { remaining: number; reset: number } | null {
    // This would need to be implemented with request tracking
    return null;
  }

  /**
   * Revoke the current access token
   */
  async revokeToken(): Promise<void> {
    const token = this.accessToken || getAccessToken();
    if (!token) return;

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    await fetch(`${REDDIT_AUTH_BASE}/api/v1/revoke_token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: new URLSearchParams({
        token,
        token_type_hint: 'access_token',
      }),
    });
  }
}
