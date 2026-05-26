import type { SimpleHashConfig } from '../types';
import { SimpleHashApiError } from '../types';

export class SimpleHashClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.simplehash.com/api/v0';

  constructor(config: SimpleHashConfig) {
    if (!config.apiKey) throw new Error('SimpleHash apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString(), { headers: { 'X-API-KEY': this.apiKey, Accept: 'application/json' } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new SimpleHashApiError((data as { message?: string })?.message || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
