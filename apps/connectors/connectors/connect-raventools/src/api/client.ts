import type { RavenToolsConfig } from '../types';
import { RavenToolsApiError } from '../types';

export class RavenToolsClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.raventools.com/api';

  constructor(config: RavenToolsConfig) {
    if (!config.apiKey) throw new Error('Raven Tools apiKey is required');
    this.apiKey = config.apiKey;
  }

  async request<T>(method: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.baseUrl);
    url.searchParams.append('key', this.apiKey);
    url.searchParams.append('method', method);
    url.searchParams.append('format', 'json');
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RavenToolsApiError((data as { error?: string })?.error || response.statusText, response.status);
    return data as T;
  }
}
