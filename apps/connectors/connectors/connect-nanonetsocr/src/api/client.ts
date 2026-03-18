import type { NanonetsConfig } from '../types';
import { NanonetsApiError } from '../types';

export class NanonetsClient {
  private readonly authHeader: string;
  private readonly baseUrl = 'https://app.nanonets.com/api/v2';

  constructor(config: NanonetsConfig) {
    if (!config.apiKey) throw new Error('Nanonets apiKey is required');
    this.authHeader = `Basic ${btoa(`${config.apiKey}:`)}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new NanonetsApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
