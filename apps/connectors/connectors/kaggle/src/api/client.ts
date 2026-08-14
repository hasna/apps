import type { KaggleConfig } from '../types';
import { KaggleApiError } from '../types';

export class KaggleClient {
  private readonly authHeader: string;
  private readonly baseUrl = 'https://www.kaggle.com/api/v1';

  constructor(config: KaggleConfig) {
    if (!config.username || !config.key) throw new Error('Kaggle username and key are required');
    this.authHeader = `Basic ${btoa(`${config.username}:${config.key}`)}`;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString(), { headers: { Authorization: this.authHeader } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new KaggleApiError((data as { message?: string })?.message || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
