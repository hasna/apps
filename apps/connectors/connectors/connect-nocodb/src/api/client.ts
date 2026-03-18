import type { NocoDBConfig } from '../types';
import { NocoDBApiError } from '../types';

export class NocoDBClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(config: NocoDBConfig) {
    if (!config.token) throw new Error('NocoDB token is required');
    this.token = config.token;
    this.baseUrl = (config.baseUrl || 'https://app.nocodb.com').replace(/\/$/, '');
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'xc-token': this.token, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new NocoDBApiError((data as { msg?: string })?.msg || response.statusText, response.status);
    return data as T;
  }
}
