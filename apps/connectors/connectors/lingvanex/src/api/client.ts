import type { LingvanexConfig } from '../types';
import { LingvanexApiError } from '../types';

export class LingvanexClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api-b2b.backenster.com/b1/api/v3';

  constructor(config: LingvanexConfig) {
    if (!config.apiKey) throw new Error('Lingvanex apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'POST', body } = options;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, fetchOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || (data as { err?: string }).err) throw new LingvanexApiError((data as { err?: string })?.err || response.statusText, response.status);
    return data as T;
  }
}
