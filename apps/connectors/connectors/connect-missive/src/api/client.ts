import type { MissiveConfig } from '../types';
import { MissiveApiError } from '../types';

const DEFAULT_BASE_URL = 'https://public.missiveapp.com/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
}

export class MissiveClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: MissiveConfig) {
    if (!config.apiKey) throw new Error('Missive API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;

    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
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
      const msg = (data as { message?: string; error?: string })?.message
        || (data as { error?: string })?.error
        || response.statusText;
      throw new MissiveApiError(msg, response.status);
    }
    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }
  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }
  async patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }
  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  getApiKeyPreview(): string {
    return `${this.apiKey.substring(0, 8)}...`;
  }
}
