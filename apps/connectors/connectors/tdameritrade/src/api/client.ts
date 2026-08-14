import type { TDAConfig } from '../types';
import { TDAApiError } from '../types';

export class TDAClient {
  private readonly apiKey: string;
  private readonly accessToken?: string;
  private readonly baseUrl = 'https://api.tdameritrade.com/v1';

  constructor(config: TDAConfig) {
    if (!config.apiKey) throw new Error('TD Ameritrade apiKey is required');
    this.apiKey = config.apiKey;
    this.accessToken = config.accessToken;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (!this.accessToken) url.searchParams.append('apikey', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new TDAApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}
