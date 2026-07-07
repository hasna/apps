import type { TwitchConfig, OAuthTokenResponse } from '../types';
import { TwitchApiError } from '../types';
import {
  getAccessToken,
  getRefreshToken,
  getClientId,
  getClientSecret,
  isTokenExpired,
  saveTokens,
} from '../utils/config';

const HELIX_BASE = 'https://api.twitch.tv/helix';
const OAUTH_BASE = 'https://id.twitch.tv/oauth2';

export interface TwitchRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class TwitchClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken?: string;
  private refreshToken?: string;
  private tokenExpiresAt?: number;

  constructor(config: TwitchConfig) {
    if (!config.clientId) throw new Error('Twitch Client ID is required');
    if (!config.clientSecret) throw new Error('Twitch Client Secret is required');
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.tokenExpiresAt = config.tokenExpiresAt;
  }

  static getAuthorizationUrl(
    clientId: string,
    redirectUri: string,
    scopes: string[],
    state: string,
  ): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
    });
    return `${OAUTH_BASE}/authorize?${params.toString()}`;
  }

  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ): Promise<OAuthTokenResponse> {
    const response = await fetch(`${OAUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new TwitchApiError(`Failed to exchange code: ${text}`, response.status);
    }
    return response.json() as Promise<OAuthTokenResponse>;
  }

  async refreshAccessToken(): Promise<void> {
    const refreshToken = this.refreshToken || getRefreshToken();
    if (!refreshToken) {
      throw new TwitchApiError('No refresh token available. Please re-authenticate.', 401);
    }

    const response = await fetch(`${OAUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new TwitchApiError(`Failed to refresh token: ${text}`, response.status);
    }

    const data = (await response.json()) as OAuthTokenResponse;
    this.accessToken = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    saveTokens(
      data.access_token,
      data.refresh_token || refreshToken,
      data.expires_in,
      data.scope,
    );
  }

  private async getValidAccessToken(): Promise<string> {
    let token = this.accessToken || getAccessToken();
    const expired = this.tokenExpiresAt
      ? Date.now() >= this.tokenExpiresAt - 60000
      : isTokenExpired();

    if (!token || expired) {
      await this.refreshAccessToken();
      token = this.accessToken || getAccessToken();
    }

    if (!token) {
      throw new TwitchApiError('No access token available. Please authenticate first.', 401);
    }
    return token;
  }

  async request<T>(endpoint: string, options: TwitchRequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const accessToken = await this.getValidAccessToken();
    const url = new URL(`${HELIX_BASE}${endpoint}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': this.clientId,
      ...headers,
    };

    let requestBody: string | undefined;
    if (body && method !== 'GET') {
      requestHeaders['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), {
      method,
      headers: requestHeaders,
      body: requestBody,
    });

    if (response.status === 204) return {} as T;

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      let message = `Twitch API Error: ${response.status} ${response.statusText}`;
      let code: string | undefined;
      if (typeof data === 'object' && data !== null) {
        const err = data as { message?: string; error?: string; status?: number };
        message = err.message || message;
        code = err.error;
      }
      throw new TwitchApiError(message, response.status, code);
    }

    return data as T;
  }

  getClientIdValue(): string {
    return this.clientId;
  }
}
