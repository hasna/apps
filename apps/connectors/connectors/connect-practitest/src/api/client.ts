import type { PractiTestConfig } from '../types';
import { PractiTestApiError } from '../types';

export class PractiTestClient {
  private readonly authHeader: string;
  private readonly baseUrl = 'https://api.practitest.com/api/v2';

  constructor(config: PractiTestConfig) {
    if (!config.email || !config.apiToken) throw new Error('PractiTest email and apiToken are required');
    this.authHeader = `Basic ${btoa(`${config.email}:${config.apiToken}`)}`;
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
    if (!response.ok) throw new PractiTestApiError((data as { errors?: { title?: string }[] })?.errors?.[0]?.title || response.statusText, response.status);
    return data as T;
  }
}
