import type { TikTokAdsApiResponse, TikTokAdsConfig } from '../types';
import { TikTokAdsApiError } from '../types';

const DEFAULT_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | string[] | undefined>;
  body?: Record<string, unknown> | unknown[] | string | object;
  headers?: Record<string, string>;
}

export class TikTokAdsClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly defaultAdvertiserId?: string;

  constructor(config: TikTokAdsConfig) {
    if (!config.accessToken) {
      throw new Error('Access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.defaultAdvertiserId = config.advertiserId;
  }

  getDefaultAdvertiserId(): string | undefined {
    return this.defaultAdvertiserId;
  }

  requireAdvertiserId(advertiserId?: string): string {
    const resolved = advertiserId || this.defaultAdvertiserId;
    if (!resolved) {
      throw new Error(
        'Advertiser ID required. Use --advertiser or set TIKTOK_ADS_ADVERTISER_ID / connect-tiktokads config set-advertiser',
      );
    }
    return resolved;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
          url.searchParams.append(key, JSON.stringify(value));
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      'Access-Token': this.accessToken,
      Accept: 'application/json',
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
    const contentType = response.headers.get('content-type') || '';

    let data: TikTokAdsApiResponse<T>;
    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (!text) {
        throw new TikTokAdsApiError('Empty response body', response.status, 'unknown');
      }
      try {
        data = JSON.parse(text);
      } catch {
        throw new TikTokAdsApiError(`Invalid JSON response: ${text}`, response.status, 'unknown');
      }
    } else {
      const text = await response.text();
      throw new TikTokAdsApiError(
        `Unexpected content type: ${contentType}. Body: ${text}`,
        response.status,
        'unknown',
      );
    }

    if (data.code !== 0) {
      throw new TikTokAdsApiError(data.message, data.code, data.request_id);
    }

    return data.data;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(
    path: string,
    body?: Record<string, unknown> | unknown[] | string | object,
    params?: Record<string, string | number | boolean | string[] | undefined>,
  ): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }
}
