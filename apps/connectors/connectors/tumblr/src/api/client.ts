import type { TumblrConfig, TumblrApiResponse } from '../types';
import { TumblrApiError } from '../types';
import {
  getAccessToken,
  getRefreshToken,
  getClientId,
  getClientSecret,
  getTokenExpiresAt,
  saveTokens,
} from '../utils/config';
import { refreshAccessToken } from '../utils/auth';

export const TUMBLR_API_BASE = 'https://api.tumblr.com/v2';

export interface TumblrRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  retries?: number;
}

/**
 * Normalize a blog identifier to a full Tumblr hostname.
 * Accepts "staff" or "staff.tumblr.com".
 */
export function blogPath(blog: string): string {
  const value = blog.trim();
  if (!value) {
    throw new Error('blog is required');
  }
  return value.includes('.') ? value : `${value}.tumblr.com`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export class TumblrClient {
  private accessToken: string;
  private refreshToken?: string;
  private tokenExpiresAt?: number;
  private readonly clientId?: string;
  private readonly clientSecret?: string;

  constructor(config: TumblrConfig) {
    if (!config.accessToken) {
      throw new Error('Tumblr access token is required');
    }
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.tokenExpiresAt = config.tokenExpiresAt;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  private async getValidAccessToken(): Promise<string> {
    let token = this.accessToken || getAccessToken();
    const expiresAt = this.tokenExpiresAt ?? getTokenExpiresAt();
    const expired = expiresAt ? Date.now() >= expiresAt - 60000 : false;

    if (token && !expired) {
      return token;
    }

    if (expired) {
      await this.refreshTokenIfNeeded();
      token = this.accessToken || getAccessToken();
    }

    if (!token) {
      throw new TumblrApiError('No access token available. Please authenticate first.', 401);
    }

    return token;
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    const refreshToken = this.refreshToken || getRefreshToken();
    const clientId = this.clientId || getClientId();
    const clientSecret = this.clientSecret || getClientSecret();

    if (!refreshToken || !clientId || !clientSecret) {
      throw new TumblrApiError('No refresh token available. Please re-authenticate.', 401);
    }

    const data = await refreshAccessToken(clientId, clientSecret, refreshToken);
    this.accessToken = data.access_token;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    saveTokens(data.access_token, data.refresh_token || refreshToken, data.expires_in, data.scope);
  }

  async request<T = unknown>(
    path: string,
    options: TumblrRequestOptions = {},
  ): Promise<TumblrApiResponse<T>> {
    const { method = 'GET', params, body, retries = 2 } = options;
    const accessToken = await this.getValidAccessToken();
    const url = new URL(`${TUMBLR_API_BASE}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };

    let requestBody: string | undefined;
    if (body) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: requestBody,
      });

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json()
        : { meta: { status: response.status, msg: await response.text() } };

      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      }

      if (!response.ok) {
        const record = asRecord(data);
        const meta = asRecord(record.meta);
        const message = String(meta.msg ?? record.msg ?? `request failed (${response.status})`);
        throw new TumblrApiError(message, response.status);
      }

      const record = asRecord(data);
      const meta = asRecord(record.meta);
      if (meta.status && Number(meta.status) !== 200) {
        throw new TumblrApiError(String(meta.msg ?? 'Tumblr API error'), Number(meta.status));
      }

      return data as TumblrApiResponse<T>;
    }

    throw lastError ?? new TumblrApiError('Request failed after retries', 500);
  }
}
