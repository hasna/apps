import type { GenderAPIConfig } from '../types';
import { GenderAPIApiError } from '../types';

export class GenderAPIClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://gender-api.com';

  constructor(config: GenderAPIConfig) {
    if (!config.apiKey) throw new Error('Gender API apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('key', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({}));
    if (!response.ok || (data as { errmsg?: string }).errmsg) throw new GenderAPIApiError((data as { errmsg?: string })?.errmsg || response.statusText, response.status);
    return data as T;
  }
}
