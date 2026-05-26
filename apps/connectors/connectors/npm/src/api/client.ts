import type { NpmConfig } from '../types';
import { NpmApiError } from '../types';

export class NpmClient {
  private readonly token?: string;
  private readonly registryUrl = 'https://registry.npmjs.org';
  private readonly apiUrl = 'https://api.npmjs.org';

  constructor(config: NpmConfig = {}) {
    this.token = config.token;
  }

  async registryRequest<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.registryUrl}${path}`, { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new NpmApiError((data as { error?: string })?.error || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }

  async apiRequest<T>(path: string): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new NpmApiError((data as { error?: string })?.error || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
