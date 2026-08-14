import type { GristConfig } from '../types';
import { GristApiError } from '../types';

export class GristClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: GristConfig) {
    if (!config.apiKey) throw new Error('Grist apiKey is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.serverUrl || 'https://docs.getgrist.com').replace(/\/$/, '') + '/api';
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> | unknown[]; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new GristApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}
