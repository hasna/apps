import type { SmailyConfig } from '../types';
import { SmailyApiError } from '../types';

export class SmailyClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: SmailyConfig) {
    if (!config.subdomain || !config.username || !config.password) throw new Error('Smaily subdomain, username, and password are required');
    this.authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    this.baseUrl = `https://${config.subdomain}.sendsmaily.net/api`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new SmailyApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
