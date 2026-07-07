import { StandoutApiError, type StandoutConfig, type StandoutQueryParams } from '../types';

export const DEFAULT_BASE_URL = 'https://api.standout.ai/v1';

export class StandoutClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: StandoutConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      query?: StandoutQueryParams;
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, query } = options;
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
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
      const message =
        typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message?: string }).message)
          : response.statusText || 'Request failed';
      throw new StandoutApiError(message, response.status);
    }

    return data as T;
  }
}
