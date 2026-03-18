import type { YodizConfig } from '../types';
import { YodizApiError } from '../types';

export class YodizClient {
  private readonly apiKey: string;
  private readonly apiToken: string;
  private readonly baseUrl = 'https://app.yodiz.com/api/v1';

  constructor(config: YodizConfig) {
    if (!config.apiKey || !config.apiToken) throw new Error('Yodiz apiKey and apiToken are required');
    this.apiKey = config.apiKey;
    this.apiToken = config.apiToken;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'API-Key': this.apiKey, 'API-Token': this.apiToken, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new YodizApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
