import type { WatchSignalsConfig } from '../types';
import { WatchSignalsApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.watchsignals.com/v1';

export class WatchSignalsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: WatchSignalsConfig) {
    if (!config.apiKey) throw new Error('WatchSignals API key is required');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  async request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });

    const response = await fetch(url.toString(), {
      headers: {
        'x-api-key': this.apiKey,
        Accept: 'application/json',
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = (data as { message?: string; error?: string })?.message || (data as { error?: string })?.error || response.statusText;
      throw new WatchSignalsApiError(msg, response.status);
    }
    return data as T;
  }

  getApiKeyPreview(): string {
    return `${this.apiKey.substring(0, 8)}...`;
  }
}
