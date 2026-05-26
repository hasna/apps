import type { FormdeskConfig } from '../types';
import { FormdeskApiError } from '../types';

export class FormdeskClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: FormdeskConfig) {
    if (!config.apiKey || !config.subdomain) throw new Error('Formdesk apiKey and subdomain are required');
    this.apiKey = config.apiKey;
    this.baseUrl = `https://${config.subdomain}.formdesk.com/api/v1`;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('api_key', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new FormdeskApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }
}
