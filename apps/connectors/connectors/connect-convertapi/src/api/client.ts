import type { ConvertAPIConfig } from '../types';
import { ConvertAPIApiError } from '../types';

export class ConvertAPIClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://v2.convertapi.com';

  constructor(config: ConvertAPIConfig) {
    if (!config.apiKey) throw new Error('ConvertAPI apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ConvertAPIApiError((data as { Message?: string })?.Message || response.statusText, response.status);
    return data as T;
  }
}
