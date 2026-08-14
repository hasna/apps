import type { EngatiConfig } from '../types';
import { EngatiApiError } from '../types';

export class EngatiClient {
  private readonly apiKey: string;
  private readonly botKey: string;
  private readonly baseUrl = 'https://api.engati.com/v1';

  constructor(config: EngatiConfig) {
    if (!config.apiKey || !config.botKey) throw new Error('Engati apiKey and botKey are required');
    this.apiKey = config.apiKey;
    this.botKey = config.botKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Bot-Key': this.botKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new EngatiApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
