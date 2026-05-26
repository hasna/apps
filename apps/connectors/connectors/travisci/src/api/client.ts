import type { TravisCIConfig } from '../types';
import { TravisCIApiError } from '../types';

export class TravisCIClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: TravisCIConfig) {
    if (!config.token) throw new Error('Travis CI token is required');
    this.token = config.token;
    this.baseUrl = (config.baseUrl || 'https://api.travis-ci.com').replace(/\/$/, '');
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `token ${this.token}`, 'Travis-API-Version': '3', 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new TravisCIApiError((data as { error_message?: string })?.error_message || response.statusText, response.status);
    return data as T;
  }
}
