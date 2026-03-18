import type { OneSimpleAPIConfig } from '../types';
import { OneSimpleAPIApiError } from '../types';

export class OneSimpleAPIClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://onesimpleapi.com/api';

  constructor(config: OneSimpleAPIConfig) {
    if (!config.apiKey) throw new Error('One Simple API apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.append('token', this.apiKey);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new OneSimpleAPIApiError((data as { message?: string })?.message || response.statusText, response.status);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return (await response.json()) as T;
    return { url: url.toString() } as T;
  }
}
