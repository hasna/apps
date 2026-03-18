import type { StrapiConfig } from '../types';
import { StrapiApiError } from '../types';

export class StrapiClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: StrapiConfig) {
    if (!config.url || !config.token) throw new Error('Strapi url and token are required');
    this.token = config.token;
    this.baseUrl = `${config.url.replace(/\/$/, '')}/api`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = (data as { error?: { message?: string } });
      throw new StrapiApiError(err.error?.message || response.statusText, response.status);
    }
    return data as T;
  }
}
