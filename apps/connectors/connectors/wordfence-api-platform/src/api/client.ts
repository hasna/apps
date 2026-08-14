import type { WordfenceApiPlatformConfig } from '../types';
import { WordfenceApiPlatformApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://www.wordfence.com/api/intelligence/v3';

export class WordfenceApiPlatformClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: WordfenceApiPlatformConfig) {
    if (!config.apiKey) {
      throw new Error('Wordfence API Platform apiKey is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown> | string;
      params?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params, headers = {} } = options;
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
      if (typeof body === 'string') {
        fetchOptions.body = body;
      } else {
        requestHeaders['Content-Type'] = 'application/json';
        fetchOptions.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text();

    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message?: string }).message)
          : response.statusText || 'Request failed';
      throw new WordfenceApiPlatformApiError(message, response.status);
    }

    return data as T;
  }
}
