import type { SimpleLocalizeConfig } from '../types';
import { SimpleLocalizeApiError } from '../types';

export class SimpleLocalizeClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.simplelocalize.io/api/v1';

  constructor(config: SimpleLocalizeConfig) {
    if (!config.apiKey) throw new Error('SimpleLocalize apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> | unknown[]; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'X-SimpleLocalize-Token': this.apiKey, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new SimpleLocalizeApiError((data as { msg?: string })?.msg || response.statusText, response.status);
    return data as T;
  }
}
