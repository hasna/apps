import type {
  SupersetConfig,
  AuthProvider,
  LoginResponse,
  RefreshResponse,
  CsrfResponse,
  ListOptions,
  ListResult,
  ItemResult,
  SupersetErrorDetail,
} from '../types';
import { SupersetApiError } from '../types';
import { normalizeBaseUrl, getRefreshToken, saveTokens } from '../utils/config';
import { buildListQuery } from '../utils/rison';

export interface SupersetRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | string;
  headers?: Record<string, string>;
}

/**
 * Apache Superset REST API client.
 *
 * Handles JWT auth (username/password login + refresh), CSRF token retrieval
 * and session cookies (required for mutating requests), and Rison-encoded
 * list queries.
 */
export class SupersetClient {
  private readonly baseUrl: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly provider: AuthProvider;
  private accessToken?: string;
  private refreshToken?: string;
  private csrfToken?: string;
  private sessionCookie?: string;

  constructor(config: SupersetConfig) {
    if (!config.baseUrl) {
      throw new Error('Superset base URL is required');
    }
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.username = config.username;
    this.password = config.password;
    this.provider = config.provider || 'db';
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
  }

  /**
   * Authenticate with username/password and store the returned tokens.
   */
  async login(): Promise<LoginResponse> {
    if (!this.username || !this.password) {
      throw new SupersetApiError('Username and password are required to log in', 400);
    }

    const response = await fetch(`${this.baseUrl}/api/v1/security/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
        provider: this.provider,
        refresh: true,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new SupersetApiError(`Login failed: ${text}`, response.status);
    }

    this.captureSessionCookie(response);
    const data = (await response.json()) as LoginResponse;
    this.accessToken = data.access_token;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }
    saveTokens(data.access_token, data.refresh_token);
    // Invalidate any stale CSRF token issued for a previous session.
    this.csrfToken = undefined;
    return data;
  }

  /**
   * Exchange the refresh token for a new access token.
   */
  async refreshAccessToken(): Promise<void> {
    const refreshToken = this.refreshToken || getRefreshToken();
    if (!refreshToken) {
      throw new SupersetApiError('No refresh token available. Please log in again.', 401);
    }

    const response = await fetch(`${this.baseUrl}/api/v1/security/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new SupersetApiError(`Token refresh failed: ${text}`, response.status);
    }

    const data = (await response.json()) as RefreshResponse;
    this.accessToken = data.access_token;
    saveTokens(data.access_token, refreshToken);
    this.csrfToken = undefined;
  }

  /**
   * Ensure we hold a valid access token, logging in or refreshing as needed.
   */
  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }
    if (this.username && this.password) {
      await this.login();
    } else if (this.refreshToken || getRefreshToken()) {
      await this.refreshAccessToken();
    }
    if (!this.accessToken) {
      throw new SupersetApiError('Not authenticated. Configure credentials or run "auth login".', 401);
    }
    return this.accessToken;
  }

  /**
   * Fetch (and cache) a CSRF token plus session cookie. Required for any
   * mutating (non-GET) request.
   */
  async ensureCsrfToken(): Promise<string> {
    if (this.csrfToken) {
      return this.csrfToken;
    }
    const accessToken = await this.ensureAccessToken();
    const response = await fetch(`${this.baseUrl}/api/v1/security/csrf_token/`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new SupersetApiError(`Failed to fetch CSRF token: ${text}`, response.status);
    }

    this.captureSessionCookie(response);
    const data = (await response.json()) as CsrfResponse;
    this.csrfToken = data.result;
    return this.csrfToken;
  }

  /**
   * Capture the session cookie from a Set-Cookie response header.
   */
  private captureSessionCookie(response: Response): void {
    const getSetCookie = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    const cookies = typeof getSetCookie === 'function'
      ? getSetCookie.call(response.headers)
      : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie') as string] : []);
    for (const cookie of cookies) {
      const match = /session=[^;]+/.exec(cookie);
      if (match) {
        this.sessionCookie = match[0];
      }
    }
  }

  /**
   * Make an authenticated request to the Superset API.
   */
  async request<T>(endpoint: string, options: SupersetRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const accessToken = await this.ensureAccessToken();
    const url = new URL(`${this.baseUrl}${endpoint}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...headers,
    };

    // Mutating requests require a CSRF token, the matching session cookie and a
    // Referer that Superset trusts.
    if (method !== 'GET') {
      const csrf = await this.ensureCsrfToken();
      requestHeaders['X-CSRFToken'] = csrf;
      requestHeaders['Referer'] = this.baseUrl;
      if (this.sessionCookie) {
        requestHeaders['Cookie'] = this.sessionCookie;
      }
    }

    let requestBody: string | undefined;
    if (body !== undefined) {
      if (typeof body === 'string') {
        requestBody = body;
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

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw this.buildError(response.status, response.statusText, data);
    }

    return data as T;
  }

  private buildError(status: number, statusText: string, data: unknown): SupersetApiError {
    let message = `Superset API Error: ${status} ${statusText}`;
    let details: SupersetErrorDetail[] | undefined;

    if (typeof data === 'object' && data !== null) {
      const errData = data as Record<string, unknown>;
      if (typeof errData.message === 'string') {
        message = errData.message;
      }
      if (Array.isArray(errData.errors)) {
        details = errData.errors as SupersetErrorDetail[];
        const first = details[0];
        if (first?.message) {
          message = first.message;
        }
      }
    } else if (typeof data === 'string' && data.length > 0) {
      message = data;
    }

    return new SupersetApiError(message, status, details);
  }

  /**
   * Generic list ("get many") helper for a resource collection endpoint.
   */
  async list<T>(resourcePath: string, options: ListOptions = {}): Promise<ListResult<T>> {
    const q = buildListQuery(options);
    const params = q === '()' ? undefined : { q };
    return this.request<ListResult<T>>(resourcePath, { params });
  }

  /**
   * Generic get ("get one") helper for a single resource by id.
   */
  async get<T>(resourcePath: string, id: number | string): Promise<T> {
    const response = await this.request<ItemResult<T>>(`${resourcePath}${id}`);
    return response.result;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
