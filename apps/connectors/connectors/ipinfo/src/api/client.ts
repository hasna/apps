import type { IPinfoConfig } from '../types';
import { IPinfoApiError } from '../types';

export class IPinfoClient {
  private readonly token: string;
  private readonly baseUrl = 'https://ipinfo.io';

  constructor(config: IPinfoConfig) {
    if (!config.token) throw new Error('IPinfo token is required');
    this.token = config.token;
  }

  async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new IPinfoApiError((data as { error?: { title?: string } })?.error?.title || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
