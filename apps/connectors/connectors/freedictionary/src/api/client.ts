import type { FreeDictionaryConfig } from '../types';
import { FreeDictionaryApiError } from '../types';

export class FreeDictionaryClient {
  private readonly baseUrl: string;

  constructor(config: FreeDictionaryConfig = {}) {
    this.baseUrl = (config.baseUrl || 'https://api.dictionaryapi.dev/api/v2').replace(/\/$/, '');
  }

  async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new FreeDictionaryApiError((data as { title?: string; message?: string })?.message || (data as { title?: string })?.title || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
