import type { WuBookrateConfig } from '../types';
import { WuBookrateApiError } from '../types';

export class WuBookrateClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.wubookratechecker.com/v1';

  constructor(config: WuBookrateConfig) {
    if (!config.apiKey) throw new Error('Wu Bookrate Checker apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new WuBookrateApiError((data as { message?: string })?.message || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
