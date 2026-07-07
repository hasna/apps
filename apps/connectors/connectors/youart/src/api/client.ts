import type { YouArtConfig } from '../types';
import { YouArtApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://api.youart.ai/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export class YouArtClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: YouArtConfig) {
    if (!config.apiKey) {
      throw new Error('YouArt apiKey is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

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
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...headers,
    };

    const fetchOptions: RequestInit = { method, headers: requestHeaders };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    let data: unknown;
    const text = await response.text();
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
          : String(data || response.statusText);
      throw new YouArtApiError(message, response.status);
    }

    return data as T;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

const RESERVED_BODY_KEYS = new Set([
  'headers',
  'query',
  'method',
  'path',
  'projectId',
  'originalId',
  'campaignId',
]);

export function bodyFromArgs(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!RESERVED_BODY_KEYS.has(key) && value !== undefined) {
      body[key] = value;
    }
  }
  return body;
}
