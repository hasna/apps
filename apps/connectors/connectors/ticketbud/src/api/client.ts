import type { TicketbudConfig } from '../types';
import { TicketbudApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.ticketbud.com';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
}

export class TicketbudClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: TicketbudConfig) {
    if (!config.accessToken) {
      throw new Error('Ticketbud access token is required');
    }
    this.accessToken = config.accessToken;
    this.baseUrl = DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    url.searchParams.append('access_token', this.accessToken);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params } = options;
    const url = this.buildUrl(path, params);

    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    let data: unknown;

    if (contentType.includes('application/json')) {
      const text = await response.text();
      data = text ? JSON.parse(text) : {};
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorBody = (typeof data === 'object' && data !== null ? data : undefined) as
        | { error?: string; message?: string }
        | undefined;
      const message =
        errorBody?.message ||
        errorBody?.error ||
        (typeof data === 'string' && data ? data : response.statusText);
      throw new TicketbudApiError(message, response.status, errorBody);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async put<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', params });
  }

  getAccessTokenPreview(): string {
    if (this.accessToken.length > 20) {
      return `${this.accessToken.substring(0, 10)}...${this.accessToken.substring(this.accessToken.length - 6)}`;
    }
    return '***';
  }
}
