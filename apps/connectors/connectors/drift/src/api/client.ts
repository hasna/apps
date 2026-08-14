import type { DriftConfig } from '../types';
import { DriftApiError } from '../types';

const DEFAULT_BASE_URL = 'https://driftapi.com';

export class DriftClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(config: DriftConfig) {
    if (!config.accessToken) throw new Error('Drift access token is required');
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new DriftApiError((data as { error?: { message?: string } })?.error?.message || response.statusText, response.status);
    return data as T;
  }
}
