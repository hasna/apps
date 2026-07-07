import type { SolcastConfig } from '../types';
import { SolcastApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.solcast.com.au';

export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
}

export class SolcastClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SolcastConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || process.env.SOLCAST_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    url.searchParams.append('api_key', this.apiKey);
    url.searchParams.append('format', 'json');

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
    const url = this.buildUrl(path, options.params);
    const response = await fetch(url);
    const text = await response.text();

    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (!response.ok) {
      const message =
        typeof data === 'object' &&
        data !== null &&
        'response_status' in data &&
        typeof (data as { response_status?: { message?: string } }).response_status?.message === 'string'
          ? (data as { response_status: { message: string } }).response_status.message
          : typeof data === 'object' && data !== null && 'message' in data && typeof (data as { message?: string }).message === 'string'
            ? (data as { message: string }).message
            : response.statusText;
      throw new SolcastApiError(message, response.status, data);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { params });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
