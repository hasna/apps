import type { IP2LocationConfig } from '../types';
import { IP2LocationApiError } from '../types';

export class IP2LocationClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.ip2location.io';

  constructor(config: IP2LocationConfig) {
    if (!config.apiKey) throw new Error('IP2Location apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('key', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({}));
    if (!response.ok || (data as { error?: unknown }).error) throw new IP2LocationApiError((data as { error?: { error_message?: string } })?.error?.error_message || response.statusText, response.status);
    return data as T;
  }
}
