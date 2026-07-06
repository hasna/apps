import type { TestRigorConfig } from '../types';
import { TestRigorApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.testrigor.com/v1';

export class TestRigorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TestRigorConfig) {
    if (!config.apiKey) throw new Error('TestRigor API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<T> {
    const { method = 'GET', body, params } = options;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.append(key, String(value));
      });
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new TestRigorApiError(
        (data as { message?: string })?.message || response.statusText,
        response.status,
      );
    }
    return data as T;
  }
}
