import type { On2AirConfig } from '../types';
import { On2AirApiError } from '../types';

export class On2AirClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.on2air.com/v1';

  constructor(config: On2AirConfig) {
    if (!config.apiKey) throw new Error('On2Air apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new On2AirApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
