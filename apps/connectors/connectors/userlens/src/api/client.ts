import type { UserlensConfig, RawRequestOptions } from '../types';
import { DEFAULT_EVENTS_BASE_URL, DEFAULT_RAW_BASE_URL, UserlensApiError } from '../types';

export interface UserlensRequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  useRawBase?: boolean;
}

/**
 * Userlens API HTTP client with Write Code Basic authentication.
 */
export class UserlensClient {
  private readonly apiKey?: string;
  private readonly eventsBaseUrl: string;
  private readonly rawBaseUrl: string;

  constructor(config: UserlensConfig) {
    this.apiKey = config.apiKey;
    this.eventsBaseUrl = (config.eventsBaseUrl ?? DEFAULT_EVENTS_BASE_URL).replace(/\/+$/, '');
    this.rawBaseUrl = (config.rawBaseUrl ?? DEFAULT_RAW_BASE_URL).replace(/\/+$/, '');
  }

  getEventsBaseUrl(): string {
    return this.eventsBaseUrl;
  }

  getRawBaseUrl(): string {
    return this.rawBaseUrl;
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new Error('Userlens: missing api_key credential');
    }
    return this.apiKey;
  }

  private authHeader(): string {
    const writeCode = this.requireApiKey();
    return `Basic ${Buffer.from(`${writeCode}:`).toString('base64')}`;
  }

  private buildUrl(base: string, path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${base}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(path: string, options: UserlensRequestOptions = {}): Promise<T> {
    const method = (options.method ?? 'POST').toUpperCase();
    const useRawBase = options.useRawBase === true || path.startsWith('/raw/');
    const base = useRawBase ? this.rawBaseUrl : this.eventsBaseUrl;
    const url = this.buildUrl(base, path, options.query);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: this.authHeader(),
      ...options.headers,
    };

    let body: string | undefined;
    if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, { method, headers, body });

    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = {};
    }

    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message?: unknown }).message)
          : `Userlens Error: ${response.status} ${response.statusText}`;
      throw new UserlensApiError(message, response.status);
    }

    return data as T;
  }

  async rawRequest<T>(options: RawRequestOptions): Promise<T> {
    const path = options.path ?? '/event';
    return this.request<T>(path, {
      method: options.method ?? 'POST',
      body: options.body,
      query: options.query,
      headers: options.headers,
      useRawBase: options.useRawBase === true || path.startsWith('/raw/'),
    });
  }
}
