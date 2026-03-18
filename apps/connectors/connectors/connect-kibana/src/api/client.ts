import type { KibanaConfig } from '../types';
import { KibanaApiError } from '../types';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[];
}

export class KibanaClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: KibanaConfig) {
    if (!config.baseUrl) throw new Error('Kibana base URL is required');
    this.baseUrl = config.baseUrl.replace(/\/$/, '');

    if (config.apiKey) {
      this.authHeader = `ApiKey ${config.apiKey}`;
    } else if (config.username && config.password) {
      this.authHeader = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
    } else {
      throw new Error('Kibana auth required: provide apiKey or username+password');
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body } = options;

    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.append(k, String(v));
      });
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      'kbn-xsrf': 'true',
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
      throw new KibanaApiError(msg, response.status);
    }
    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }
  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }
  async put<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }
  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}
