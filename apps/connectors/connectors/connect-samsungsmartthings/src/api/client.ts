import type { SmartThingsConfig } from '../types';
import { SmartThingsApiError } from '../types';

export class SmartThingsClient {
  private readonly token: string;
  private readonly baseUrl = 'https://api.smartthings.com/v1';

  constructor(config: SmartThingsConfig) {
    if (!config.token) throw new Error('SmartThings token is required');
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
    if (!response.ok) throw new SmartThingsApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
