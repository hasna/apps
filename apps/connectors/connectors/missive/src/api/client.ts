import type { MissiveConfig } from '../types';
import { MissiveApiError } from '../types';

export class MissiveClient {
  private readonly token: string;
  private readonly baseUrl = 'https://mail.missiveapp.com/api/v1';

  constructor(config: MissiveConfig) {
    if (!config.token) throw new Error('Missive token is required');
    this.token = config.token;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new MissiveApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}
