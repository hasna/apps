import type { SnapConfig, TokenResponse, OutputFormat } from '../types';
import { SnapApiError } from '../types';
import {
  getRefreshToken,
  getClientId,
  getClientSecret,
  setTokens,
  isTokenExpired,
} from '../utils/config';

const DEFAULT_BASE_URL = 'https://adsapi.snapchat.com/v1';
const AUTH_URL = 'https://accounts.snapchat.com/login/oauth2/access_token';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string | FormData;
  headers?: Record<string, string>;
  format?: OutputFormat;
  skipAuth?: boolean;
}

export class SnapClient {
  private accessToken: string;
  private readonly baseUrl: string;
  private refreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;
  private tokenExpiresAt?: number;
  private isRefreshing: boolean = false;
  private refreshPromise?: Promise<void>;

  constructor(config: SnapConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<void> {
    // If already refreshing, wait for that to complete
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.refreshToken || getRefreshToken();
    const clientId = this.clientId || getClientId();
    const clientSecret = this.clientSecret || getClientSecret();

    if (!refreshToken) {
      throw new Error('No refresh token available. Please re-authenticate.');
    }

    if (!clientId || !clientSecret) {
      throw new Error('Client ID and Client Secret are required for token refresh.');
    }

    this.isRefreshing = true;

    this.refreshPromise = (async () => {
      try {
        const params = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        });

        const response = await fetch(AUTH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new SnapApiError(
            `Failed to refresh token: ${error}`,
            response.status
          );
        }

        const data = await response.json() as TokenResponse;

        // Update the client's token
        this.accessToken = data.access_token;
        this.refreshToken = data.refresh_token;
        this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);

        // Save tokens to config
        setTokens(data.access_token, data.refresh_token, data.expires_in);
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = undefined;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Check if token needs refresh and refresh if necessary
   */
  private async ensureValidToken(): Promise<void> {
    if (isTokenExpired() && this.refreshToken) {
      await this.refreshAccessToken();
    }
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
   * Make an authenticated request to Snapchat Marketing API
   * Uses OAuth 2.0 Bearer token authentication
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, skipAuth = false } = options;

    // Ensure token is valid before making request
    if (!skipAuth) {
      await this.ensureValidToken();
    }

    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Accept': 'application/json',
      ...headers,
    };

    // Don't set Content-Type for FormData (browser/node will set it with boundary)
    if (body && !(body instanceof FormData) && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof FormData) {
        fetchOptions.body = body;
      } else {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
    }

    let response = await fetch(url, fetchOptions);

    // Handle token expiration (401 Unauthorized)
    if (response.status === 401 && !skipAuth && this.refreshToken) {
      await this.refreshAccessToken();
      // Retry the request with new token
      requestHeaders['Authorization'] = `Bearer ${this.accessToken}`;
      fetchOptions.headers = requestHeaders;
      response = await fetch(url, fetchOptions);
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
      const apiResponse = data as Record<string, unknown> | undefined;
      const requestId = apiResponse?.request_id as string | undefined;
      const errors = apiResponse?.errors as Array<{ reason: string; message: string }> | undefined;
      const errorMessage = errors?.[0]?.message ||
        (typeof data === 'object' && data !== null
          ? JSON.stringify(data)
          : String(data || response.statusText));

      throw new SnapApiError(errorMessage, response.status, requestId, errors);
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
   * Upload file with multipart/form-data
   */
  async upload<T>(path: string, formData: FormData): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: formData });
  }

  /**
   * Get a preview of the access token (for display/debugging)
   */
  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }

  /**
   * Check if client can refresh tokens
   */
  canRefreshToken(): boolean {
    return !!(this.refreshToken || getRefreshToken()) &&
           !!(this.clientId || getClientId()) &&
           !!(this.clientSecret || getClientSecret());
  }
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const response = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new SnapApiError(
      `Failed to exchange code for tokens: ${error}`,
      response.status
    );
  }

  return response.json() as Promise<TokenResponse>;
}

/**
 * Generate OAuth authorization URL
 */
export function generateAuthUrl(
  clientId: string,
  redirectUri: string,
  scopes: string[] = ['snapchat-marketing-api'],
  state?: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
  });

  if (state) {
    params.append('state', state);
  }

  return `https://accounts.snapchat.com/login/oauth2/authorize?${params.toString()}`;
}
