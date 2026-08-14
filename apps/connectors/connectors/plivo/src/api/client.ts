import type { PlivoConfig } from '../types';
import { PlivoApiError } from '../types';

export class PlivoClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(config: PlivoConfig) {
    if (!config.authId || !config.authToken) throw new Error('Plivo authId and authToken are required');
    this.authHeader = `Basic ${btoa(`${config.authId}:${config.authToken}`)}`;
    this.baseUrl = `https://api.plivo.com/v1/Account/${config.authId}`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}/`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: this.authHeader, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new PlivoApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}
