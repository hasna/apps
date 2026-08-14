import type { CodyConfig } from '../types';
import { CodyApiError } from '../types';

export class CodyClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: CodyConfig) {
    if (!config.token) throw new Error('Cody/Sourcegraph token is required');
    this.token = config.token;
    this.baseUrl = (config.endpoint || 'https://sourcegraph.com').replace(/\/$/, '');
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `token ${this.token}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CodyApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
