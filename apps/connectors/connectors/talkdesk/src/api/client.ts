import type { TalkdeskConfig, OAuthTokenResponse } from '../types';
import { TalkdeskApiError } from '../types';

// Default Talkdesk API base URL. Use the base URL that matches the region
// where your account is hosted (override via config.baseUrl / TALKDESK_BASE_URL).
// See: https://docs.talkdesk.com/reference/api-reference
export const DEFAULT_BASE_URL = 'https://api.talkdeskapp.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Number of retries for retryable failures (default: 3) */
  retries?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * HTTP client for the Talkdesk API.
 *
 * Authenticates with the OAuth 2.0 client credentials grant against
 * `${baseUrl}/oauth/token` (HTTP Basic auth of client_id:client_secret),
 * caches the bearer token, and refreshes it when it expires. A pre-obtained
 * access token can be supplied instead to skip the token exchange.
 */
export class TalkdeskClient {
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly baseUrl: string;
  private readonly authUrl: string;

  private accessToken?: string;
  private tokenExpiresAt = 0;
  /** Whether the access token was supplied directly (never refreshed) */
  private readonly staticToken: boolean;

  constructor(config: TalkdeskConfig) {
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.authUrl = config.authUrl || '';

    if (config.accessToken) {
      this.accessToken = config.accessToken;
      this.staticToken = true;
      // Treat a supplied token as valid until the API says otherwise.
      this.tokenExpiresAt = Number.MAX_SAFE_INTEGER;
    } else {
      this.staticToken = false;
      if (!config.clientId || !config.clientSecret) {
        throw new Error(
          'Talkdesk credentials are required: provide clientId + clientSecret, or an accessToken'
        );
      }
      if (!this.authUrl) {
        throw new Error(
          'Talkdesk authUrl is required for client credentials. Set TALKDESK_AUTH_URL to your account identity endpoint, e.g. https://<account>.talkdeskid.com/oauth/token'
        );
      }
      this.clientId = config.clientId;
      this.clientSecret = config.clientSecret;
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
   * Fetch (and cache) an OAuth access token via the client credentials grant.
   * Requests are signed using HTTP Basic authentication of the client_id and
   * client_secret, per https://docs.talkdesk.com/reference/cc-basic
   */
  async getAccessToken(): Promise<string> {
    // Refresh 30s before expiry to avoid using a token mid-flight.
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.accessToken;
    }

    if (this.staticToken) {
      // Supplied token: return as-is (cannot be refreshed).
      return this.accessToken as string;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await fetch(this.authUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text;
    }

    if (!response.ok) {
      throw new TalkdeskApiError(
        `OAuth token request failed: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
        response.status,
        data
      );
    }

    const token = data as OAuthTokenResponse;
    if (!token.access_token) {
      throw new TalkdeskApiError('OAuth token response did not include an access_token', 500, data);
    }

    this.accessToken = token.access_token;
    // expires_in is in seconds; default to 10 minutes if absent.
    const ttl = (token.expires_in && token.expires_in > 0 ? token.expires_in : 600) * 1000;
    this.tokenExpiresAt = Date.now() + ttl;
    return this.accessToken;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {}, retries = 3, timeout = 30000 } = options;
    const url = this.buildUrl(path, params);

    let lastError: Error | null = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const token = await this.getAccessToken();

        const requestHeaders: Record<string, string> = {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          ...headers,
        };
        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          requestHeaders['Content-Type'] = 'application/json';
        }

        const fetchOptions: RequestInit = { method, headers: requestHeaders };
        if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
          fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        let response: Response;
        try {
          response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        lastStatus = response.status;

        if (response.status === 204) {
          return {} as T;
        }

        let data: unknown;
        const contentType = response.headers.get('content-type') || '';
        const respText = await response.text();
        if (contentType.includes('application/json')) {
          try {
            data = respText ? JSON.parse(respText) : undefined;
          } catch {
            data = respText;
          }
        } else {
          data = respText;
        }

        if (!response.ok) {
          // An expired supplied token can't be refreshed; surface the auth error.
          if (this.isRetryableStatus(response.status) && attempt < retries) {
            const retryAfter = response.headers.get('retry-after');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.getRetryDelay(attempt);
            await this.sleep(delay);
            continue;
          }
          const message = typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data || response.statusText);
          throw new TalkdeskApiError(message, response.status, data);
        }

        return data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        }
        // Retry transient network errors, but not API errors we already decided on.
        if (attempt < retries && !(err instanceof TalkdeskApiError)) {
          await this.sleep(this.getRetryDelay(attempt));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new TalkdeskApiError('Request failed', lastStatus);
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  async put<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body, params });
  }

  async patch<T>(path: string, body?: unknown, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
