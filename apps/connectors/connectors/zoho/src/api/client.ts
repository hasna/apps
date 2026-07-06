import type { ZohoConfig } from '../types';
import { ZohoApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://www.zohoapis.com/crm/v8';

export interface RequestOptions {
  method?: string;
  body?: Record<string, unknown> | unknown[];
  params?: Record<string, string | number | boolean | undefined>;
}

export class ZohoClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: ZohoConfig) {
    if (!config.accessToken) {
      throw new Error('Zoho access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getAccessTokenPreview(): string {
    if (this.accessToken.length > 10) {
      return `${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
    }
    return '***';
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.accessToken}`,
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    if (body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const err = data as { message?: string; code?: string };
      throw new ZohoApiError(err.message || response.statusText, response.status, err.code);
    }

    return data as T;
  }
}
